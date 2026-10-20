const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const summaries = require('./release-summaries.cjs');

const usage = `Usage:
  npm run release:prepare -- [patch|minor|major|X.Y.Z] --notes-file PATH --summary-file PATH
  npm run release:verify -- --tag vX.Y.Z

Preparation defaults to patch and only edits version files and release notes.
The notes file contains this release's body, without a version heading.
The summary file is JSON with summary (and optional important) arrays in all nine languages; the command adds the version.
GitHub access is required; GH_TOKEN or GITHUB_TOKEN is optional for public repositories.`;

function parseVersion(value) {
 if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Use a stable version in X.Y.Z format: ' + value);
 const parts = value.split('.').map(Number);
 if (!parts.every(Number.isSafeInteger)) throw new Error('Version components exceed the supported integer range.');
 return parts;
}
function compareVersions(left, right) {
 const a = parseVersion(left), b = parseVersion(right);
 for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
 return 0;
}
function nextVersion(current, increment) {
 const parts = parseVersion(current), index = ['major', 'minor', 'patch'].indexOf(increment);
 if (index !== -1) {
  parts[index]++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  increment = parts.join('.');
 }
 if (compareVersions(increment, current) <= 0) throw new Error('Prepared version must be greater than the current package version.');
 return increment;
}
function readState(root) {
 const names = ['package.json', 'package-lock.json', 'docs/release-notes.md'];
 for (const name of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json']) {
  if (fs.existsSync(path.join(root, name))) names.push(name);
 }
 const originals = new Map(names.map(name => [path.join(root, name), fs.readFileSync(path.join(root, name), 'utf8')]));
 const source = summaries.readSource(root);
 for (const [file, content] of source.originals) originals.set(file, content);
 const pkg = JSON.parse(originals.get(path.join(root, names[0]))), lock = JSON.parse(originals.get(path.join(root, names[1])));
 parseVersion(pkg.version);
 if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('package.json and both root package-lock.json versions must match.');
 const cargo = originals.get(path.join(root, 'src-tauri/Cargo.toml'));
 if (cargo && cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1] !== pkg.version) throw new Error('Cargo.toml and package.json versions must match.');
 const cargoLock = originals.get(path.join(root, 'src-tauri/Cargo.lock'));
 if (cargoLock && cargoLock.match(/\[\[package\]\]\s*\nname = "md2chat"\s*\nversion = "([^"]+)"/)?.[1] !== pkg.version) throw new Error('Cargo.lock and package.json versions must match.');
 const tauri = originals.get(path.join(root, 'src-tauri/tauri.conf.json'));
 if (tauri && JSON.parse(tauri).version !== '../package.json') throw new Error('Tauri must read its version from ../package.json.');
 const publish = pkg.build?.publish;
 if (publish?.provider !== 'github' || !/^[\w.-]+$/.test(publish.owner || '') || !/^[\w.-]+$/.test(publish.repo || '')) throw new Error('Configure the GitHub update repository in package.json build.publish.');
 return {pkg, lock, originals, catalog: source.catalog, notes: originals.get(path.join(root, names[2])), repository: publish.owner + '/' + publish.repo};
}
function validateBody(body) {
 const lines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^#{1,6}\s/.test(line));
 let substantive = false;
 for (const line of lines) {
  const text = line.replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s*/, '').replace(/[*_`~]/g, '').trim();
  if (/^(?:(?:TODO|TBD|FIXME|placeholder)(?:\b|$)|待补充|待填写|待完善|请填写|请补充|此处填写|更新说明待|占位)/i.test(text)) throw new Error('Replace release-note placeholders with the actual changes.');
  if (/[\p{L}\p{N}]/u.test(text)) substantive = true;
 }
 if (!substantive) throw new Error('Release notes must contain a nonempty description of the changes.');
}
function validateNotes(notes, version) {
 const lines = notes.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
 if (lines[0].trim() !== '# v' + version) throw new Error('The first release-notes heading must be # v' + version + '.');
 const nextHeading = lines.findIndex((line, i) => i > 0 && /^#{1,6}\s+v\d+\.\d+\.\d+\s*$/.test(line));
 validateBody(lines.slice(1, nextHeading === -1 ? undefined : nextHeading).join('\n'));
}
async function fetchLatestVersion(repository, fetchImpl, env) {
 const headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'md2chat-release', 'X-GitHub-Api-Version': '2022-11-28'};
 const token = env.GH_TOKEN || env.GITHUB_TOKEN;
 if (token) headers.Authorization = 'Bearer ' + token;
 async function request(suffix) {
  try {
   return await fetchImpl('https://api.github.com/repos/' + repository + suffix, {headers, signal: AbortSignal.timeout(15000), redirect: 'error'});
  } catch {
   throw new Error('Unable to check GitHub: network error or timeout. Release preparation and publication stopped.');
  }
 }
 async function json(response) {
  try {return await response.json();}
  catch {throw new Error('GitHub returned invalid release information.');}
 }
 const response = await request('/releases/latest');
 if (response.status === 404) {
  const repoResponse = await request('');
  if (!repoResponse.ok) throw new Error('Cannot confirm the update repository is accessible (HTTP ' + repoResponse.status + ').');
  const repo = await json(repoResponse);
  if (typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== repository.toLowerCase()) throw new Error('GitHub returned an unexpected update repository.');
  return null;
 }
 if (!response.ok) throw new Error('Cannot check the latest release (HTTP ' + response.status + ').');
 const latest = await json(response);
 if (latest.draft !== false || latest.prerelease !== false || typeof latest.tag_name !== 'string') throw new Error('GitHub Latest must identify a published stable release.');
 const version = latest.tag_name.replace(/^v/, '');
 parseVersion(version);
 return version;
}
function requireNewer(version, latest) {
 if (latest !== null && compareVersions(version, latest) <= 0) throw new Error('Release v' + version + ' must be greater than GitHub Latest v' + latest + '.');
}
function writePreparedFiles(originals, contents) {
 for (const [file, original] of originals) if (original === null ? fs.existsSync(file) : fs.readFileSync(file, 'utf8') !== original) throw new Error('Release files changed during validation. Review the changes and prepare again.');
 const staged = [], replaced = [];
 try {
  for (const [file, content] of contents) {
   fs.mkdirSync(path.dirname(file), {recursive:true});
   const temporary = file + '.release-' + randomUUID() + '.tmp';
   staged.push([file, temporary]);
   fs.writeFileSync(temporary, content, {flag: 'wx'});
  }
  for (const [file, temporary] of staged) {fs.renameSync(temporary, file);replaced.push(file);}
 } catch (error) {
  for (const file of replaced) {
   if (originals.get(file) === null) fs.rmSync(file, {force:true});
   else fs.writeFileSync(file, originals.get(file));
  }
  throw error;
 } finally {
  for (const [, temporary] of staged) fs.rmSync(temporary, {force: true});
 }
}
function parseArgs(args) {
 const [command, ...rest] = args, options = {}, positional = [];
 if (!['prepare', 'verify'].includes(command)) throw new Error(usage);
 for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (arg.startsWith('--')) {
   if (!['--notes-file', '--summary-file', '--tag'].includes(arg) || options[arg] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(usage);
   options[arg] = rest[++i];
  } else positional.push(arg);
 }
 if (command === 'prepare' && (!options['--notes-file'] || !options['--summary-file'] || options['--tag'] || positional.length > 1)) throw new Error(usage);
 if (command === 'verify' && (!options['--tag'] || options['--notes-file'] || options['--summary-file'] || positional.length)) throw new Error(usage);
 return {command, options, increment: positional[0] || 'patch'};
}
async function run(args, {root = path.resolve(__dirname, '..'), fetchImpl = globalThis.fetch, env = process.env, log = console.log} = {}) {
 if ((args.length === 1 && args[0] === '--help') || (args.length === 2 && ['prepare', 'verify'].includes(args[0]) && args[1] === '--help')) {log(usage);return;}
 const {command, options, increment} = parseArgs(args), state = readState(root);
 let version = state.pkg.version, body;
 let catalog = summaries.validateCatalog(state.catalog, version, state.notes, {allowUnpublishedHead: command === 'prepare'});
 if (command === 'prepare') {
  version = nextVersion(version, increment);
  body = fs.readFileSync(path.resolve(options['--notes-file']), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (/^#{1,6}\s+v\d+\.\d+\.\d+\s*$/m.test(body)) throw new Error('Provide only the release-notes body; the version heading is added automatically.');
  validateBody(body);
  const entry = JSON.parse(fs.readFileSync(path.resolve(options['--summary-file']), 'utf8'));
  if (entry.version !== undefined) throw new Error('Omit the summary version; the preparation command adds it.');
  catalog = summaries.validateCatalog([{...entry, version}, ...catalog], version, '# v' + version + '\n\n' + body + '\n\n' + state.notes);
  state.originals.set(path.join(root, summaries.entryFile(version)), null);
 } else {
  if (options['--tag'] !== 'v' + version) throw new Error('The release tag must match package.json: v' + version + '.');
  validateNotes(state.notes, version);
 }
 const latestVersion = await fetchLatestVersion(state.repository, fetchImpl, env);
 requireNewer(version, latestVersion);
 if (command === 'prepare') {
  const originalSummaries = [...state.originals.keys()].filter(file => file.startsWith(path.join(root, summaries.directory) + path.sep) && state.originals.get(file) !== null).sort();
  if (JSON.stringify([...summaries.readSource(root).originals.keys()].sort()) !== JSON.stringify(originalSummaries)) throw new Error('Release files changed during validation. Review the changes and prepare again.');
  state.pkg.version = state.lock.version = state.lock.packages[''].version = version;
  const contents = new Map([
   [path.join(root, 'package.json'), JSON.stringify(state.pkg, null, 2) + '\n'],
   [path.join(root, 'package-lock.json'), JSON.stringify(state.lock, null, 2) + '\n'],
   [path.join(root, 'docs/release-notes.md'), '# v' + version + '\n\n' + body + '\n\n' + state.notes],
   [path.join(root, summaries.entryFile(version)), JSON.stringify(catalog[0], null, 2) + '\n']
  ]);
  const cargoPath = path.join(root, 'src-tauri/Cargo.toml');
  if (state.originals.has(cargoPath)) contents.set(cargoPath, state.originals.get(cargoPath).replace(/(\[package\][\s\S]*?^version\s*=\s*")[^"]+(".*$)/m, '$1' + version + '$2'));
  const cargoLockPath = path.join(root, 'src-tauri/Cargo.lock');
  if (state.originals.has(cargoLockPath)) contents.set(cargoLockPath, state.originals.get(cargoLockPath).replace(/(\[\[package\]\]\s*\nname = "md2chat"\s*\nversion = ")[^"]+(".*)/, '$1' + version + '$2'));
  writePreparedFiles(state.originals, contents);
 }
 log((command === 'prepare' ? 'Prepared' : 'Verified') + ' v' + version + ' (GitHub Latest: ' + (latestVersion === null ? 'no stable release' : 'v' + latestVersion) + ').');
 return {version, previousVersion: command === 'prepare' ? JSON.parse(state.originals.get(path.join(root, 'package.json'))).version : version, latestVersion};
}
if (require.main === module) run(process.argv.slice(2)).catch(error => {console.error(error.message);process.exitCode = 1;});
module.exports = {run, parseVersion, compareVersions, nextVersion, validateNotes};
