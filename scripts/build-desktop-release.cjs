const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {X509Certificate, randomBytes} = require('node:crypto');
const {verifyUpdaterSignature} = require('./update-manifests.cjs');
const {nativeEnv} = require('./native-env.cjs');
const developerId = /^Developer ID Application: .+\([A-Z0-9]{10}\)$/;
const macTargets = {arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin'};

function sleepSync(milliseconds) {
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function writeAppStaplerStatus(file, status) {
 try {
  fs.writeFileSync(file, status + '\n', {encoding: 'utf8', mode: 0o600});
  return true;
 } catch {
  return false;
 }
}

function runGuardedAppStapler(args, {env = process.env, run = spawnSync, sleep = sleepSync} = {}) {
 const marker = env.MD2CHAT_APP_STAPLER_STATUS;
 const realXcrun = env.MD2CHAT_REAL_XCRUN;
 const artifact = args.at(-1)?.replace(/[\\/]+$/, '');
 if (!path.isAbsolute(marker || '') || !path.isAbsolute(realXcrun || '') ||
  args[0] !== 'stapler' || args[1] !== 'staple' || !artifact?.endsWith('.app')) {
  if (path.isAbsolute(marker || '')) writeAppStaplerStatus(marker, 'failed');
  return 64;
 }
 let lastStatus = 1;
 for (let attempt = 0; attempt < 3; attempt++) {
  let result;
  try {
   result = run(realXcrun, args, {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1024 * 1024,
    timeout: 90_000
   });
  } catch {
   // Tauri currently discards stapler's exit status. Capture every diagnostic
   // here as well so certificate, account, and service details stay out of logs.
  }
  if (result?.status === 0) return writeAppStaplerStatus(marker, 'ok') ? 0 : 1;
  if (Number.isInteger(result?.status) && result.status > 0 && result.status < 256) lastStatus = result.status;
  if (attempt < 2) {
   try { sleep((attempt + 1) * 5000); } catch { break; }
  }
 }
 writeAppStaplerStatus(marker, 'failed');
 return lastStatus;
}

function withMacAppStaplerGuard(buildEnv, invoke, {realXcrun = '/usr/bin/xcrun'} = {}) {
 if (!path.isAbsolute(realXcrun)) throw new Error('Mac app stapler guard requires an absolute xcrun path');
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-xcrun-'));
 fs.chmodSync(temporary, 0o700);
 const marker = path.join(temporary, 'app-stapler.status');
 const shim = path.join(temporary, 'xcrun');
 const source = `#!/bin/sh
last=
for argument do last=$argument; done
case "\${last%/}" in
 *.app)
  if [ "\${1-}" = stapler ] && [ "\${2-}" = staple ]; then
   exec "$MD2CHAT_NODE" "$MD2CHAT_STAPLER_HELPER" --guard-app-stapler "$@"
  fi
  ;;
esac
exec "$MD2CHAT_REAL_XCRUN" "$@"
`;
 fs.writeFileSync(shim, source, {encoding: 'utf8', mode: 0o700, flag: 'wx'});
 const inheritedPath = buildEnv.PATH || process.env.PATH || '';
 const guardedEnv = {
  ...buildEnv,
  PATH: temporary + (inheritedPath ? path.delimiter + inheritedPath : ''),
  MD2CHAT_APP_STAPLER_STATUS: marker,
  MD2CHAT_REAL_XCRUN: realXcrun,
  MD2CHAT_NODE: process.execPath,
  MD2CHAT_STAPLER_HELPER: __filename
 };
 try {
  invoke(guardedEnv);
  let status;
  try { status = fs.readFileSync(marker, 'utf8').trim(); } catch {}
  if (status !== 'ok') throw new Error('Mac app ticket stapling failed during packaging; no release artifacts were copied');
 } finally {
  fs.rmSync(temporary, {recursive: true, force: true});
 }
}

function checkedStapler(command, operation, artifact, sleep) {
 for (let attempt = 0; attempt < 3; attempt++) {
  let result;
  try {
   result = command('xcrun', ['stapler', operation, artifact], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1024 * 1024,
    timeout: 90_000, allowFailure: true
   });
  } catch {
   // Do not expose service diagnostics or subprocess errors in release logs.
  }
  if (result?.status === 0) return;
  const diagnostics = String(result?.stdout || '') + '\n' + String(result?.stderr || '');
  // EX_NOHOST alone can also mean an unnotarized artifact. Retry only explicit
  // transient URL loading errors after notarization has already been Accepted.
  const transient = result?.status === 68 && /NSURLErrorDomain\b[^\r\n]*\bCode=-(1001|1003|1004|1005|1006|1009)\b/.test(diagnostics);
  if (!transient || attempt === 2) {
   throw new Error('Mac ticket ' + (operation === 'staple' ? 'stapling' : 'validation') + ' failed; no release artifacts were copied');
  }
  console.warn('Apple ticket service network error; retrying ' + operation + ' (' + (attempt + 2) + '/3)');
  sleep((attempt + 1) * 5000);
 }
}

function macSigningIdentity(env, root, run) {
 const explicit = env.APPLE_SIGNING_IDENTITY?.trim();
 if (explicit) {
  if (!developerId.test(explicit)) throw new Error('APPLE_SIGNING_IDENTITY must be a Developer ID Application identity');
  return explicit;
 }
 let temporary;
 try {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-signing-'));
  fs.chmodSync(temporary, 0o700);
  const file = writeCertificateArchive(env.CSC_LINK, temporary);
  // Older P12 exports may require OpenSSL 3's legacy provider. Both attempts
  // expose only public certificates, with the password supplied through env.
  for (const legacy of [[], ['-legacy']]) {
   try {
    const result = run('openssl', ['pkcs12', '-in', file, '-clcerts', '-nokeys', '-passin', 'env:CSC_KEY_PASSWORD', ...legacy],
     {cwd: root, env: nativeEnv(env), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1024 * 1024});
    const certificates = String(result.stdout || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
    const identities = certificates.map(pem => new X509Certificate(pem).toLegacyObject().subject.CN)
     .filter(name => typeof name === 'string' && developerId.test(name));
    if (identities.length === 1) return identities[0];
    break;
   } catch {
    // Do not expose OpenSSL errors, captured output, or the original arguments.
   }
  }
 } catch {
  // Certificate material and password must never be included in diagnostics.
 } finally {
  if (temporary) fs.rmSync(temporary, {recursive: true, force: true});
 }
 throw new Error('Cannot derive exactly one Developer ID Application identity from CSC_LINK; check the P12 certificate/password or set APPLE_SIGNING_IDENTITY');
}

function assertTestBuildScope(env, testBuild) {
 if (testBuild && env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('--test-build is allowed only for workflow_dispatch in GitHub Actions');
}

function releaseConfig(env, testBuild) {
 return {bundle: {createUpdaterArtifacts: !testBuild}, plugins: {updater: {pubkey: testBuild ? '' : env.TAURI_UPDATER_PUBLIC_KEY.trim()}}};
}

function requireNonemptyFile(file, description) {
 let stat;
 try { stat = fs.statSync(file); } catch {}
 if (!stat?.isFile() || !stat.size) throw new Error('Missing or empty ' + description + ': ' + file);
}

function writeCertificateArchive(value, directory) {
 const encoded = String(value || '').replace(/\s/g, '');
 if (encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error();
 const archive = Buffer.from(encoded, 'base64');
 try {
  if (!archive.length || archive.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error();
  const file = path.join(directory, 'certificate.p12');
  fs.writeFileSync(file, archive, {mode: 0o600, flag: 'wx'});
  return file;
 } finally {
  archive.fill(0);
 }
}

function dmgBuildEnv(env) {
 const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'USER', 'LOGNAME', 'SHELL', '__CF_USER_TEXT_ENCODING', 'SYSTEM_VERSION_COMPAT', 'COMMAND_MODE'];
 return Object.fromEntries(allowed.filter(name => typeof env[name] === 'string').map(name => [name, env[name]]));
}

function signMacDmg(command, env, identity, dmg) {
 let temporary;
 let keychain;
 let originalKeychains;
 let searchListChanged = false;
 let failureStage;
 let stage = 'reading the user keychain search list';
 const quiet = {stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1024 * 1024};
 try {
  const searchList = command('security', ['list-keychains', '-d', 'user'], quiet);
  originalKeychains = String(searchList?.stdout || '').split(/\r?\n/)
   .map(line => line.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-dmg-signing-'));
  fs.chmodSync(temporary, 0o700);
  const certificate = writeCertificateArchive(env.CSC_LINK, temporary);
  // macOS keychain services and codesign expect user keychains under this
  // directory. Keep only the P12 in the private temporary directory.
  keychain = path.join(os.homedir(), 'Library', 'Keychains',
   'md2chat-' + randomBytes(16).toString('hex') + '.keychain-db');
  const password = randomBytes(32).toString('hex');
  stage = 'creating the temporary keychain';
  command('security', ['create-keychain', '-p', password, keychain], quiet);
  stage = 'unlocking the temporary keychain';
  command('security', ['unlock-keychain', '-p', password, keychain], quiet);
  stage = 'importing the signing certificate';
  command('security', ['import', certificate, '-f', 'pkcs12', '-t', 'agg', '-k', keychain, '-P', env.CSC_KEY_PASSWORD,
   '-T', '/usr/bin/codesign'], quiet);
  stage = 'setting the temporary keychain timeout';
  command('security', ['set-keychain-settings', '-t', '3600', '-u', keychain], quiet);
  stage = 'authorizing codesign key access';
  command('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s',
   '-k', password, keychain], quiet);
  // codesign does not reliably resolve an identity from --keychain alone on
  // GitHub macOS runners. Match Tauri's certificate flow by adding this
  // short-lived keychain to the user search list for the signing operation.
  stage = 'adding the temporary keychain to the search list';
  // Restore even when security mutates the list and then reports a failure.
  searchListChanged = true;
  command('security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains, keychain], quiet);
  stage = 'signing the DMG';
  command('codesign', ['--force', '--sign', identity, '--keychain', keychain, '--timestamp', dmg], quiet);
 } catch {
  failureStage = stage;
 } finally {
  let cleanupFailed = false;
  if (searchListChanged) {
   try {
    const result = command('security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains],
     {...quiet, allowFailure: true});
    if (result?.status !== 0 || result.signal) cleanupFailed = true;
   } catch { cleanupFailed = true; }
  }
  if (keychain) {
   try {
    const result = command('security', ['delete-keychain', keychain], {...quiet, allowFailure: true});
    if (result?.status !== 0 || result.signal) cleanupFailed = true;
   } catch { cleanupFailed = true; }
   try { fs.rmSync(keychain, {force: true}); } catch { cleanupFailed = true; }
  }
  try { if (temporary) fs.rmSync(temporary, {recursive: true, force: true}); } catch { cleanupFailed = true; }
  if (failureStage) throw new Error('DMG signing failed during ' + failureStage +
   (cleanupFailed ? ' and cleanup' : '') + '; no release artifacts were copied');
  if (cleanupFailed) throw new Error('DMG signing cleanup failed; no release artifacts were copied');
 }
}

function buildMacBinary(arch, {env = process.env, root = path.resolve(__dirname, '..'), run = runCommand, testBuild = false} = {}) {
 const target = macTargets[arch];
 if (!target) throw new Error('Invalid Mac binary target: use arm64 or x64');
 assertTestBuildScope(env, testBuild);
 if (!testBuild && !env.TAURI_UPDATER_PUBLIC_KEY?.trim()) throw new Error('Configure GitHub Actions Secrets: TAURI_UPDATER_PUBLIC_KEY');
 const buildEnv = nativeEnv(env);
 const command = (name, args, options = {}) => run(name, args, {cwd: root, env: buildEnv, stdio: 'inherit', ...options});
 command(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--target', target,
  '--no-bundle', '--no-sign', '--config', JSON.stringify(releaseConfig(env, testBuild))]);
 const binary = path.join(path.resolve(root, env.CARGO_TARGET_DIR || 'src-tauri/target'), target, 'release', 'md2chat');
 requireNonemptyFile(binary, arch + ' Mac release binary');
 return binary;
}

function buildRelease(platform, arch, {env = process.env, root = path.resolve(__dirname, '..'), run = runCommand, testBuild = false, prebuilt = false, sleep = sleepSync, realXcrun = '/usr/bin/xcrun'} = {}) {
 if (!((platform === 'mac' && arch === 'universal') || (platform === 'win' && arch === 'x64'))) throw new Error('Invalid build target: use mac universal or win x64');
 if (prebuilt && platform !== 'mac') throw new Error('--prebuilt is allowed only for mac universal');
 assertTestBuildScope(env, testBuild);
 const target = platform === 'mac' ? 'universal-apple-darwin' : 'x86_64-pc-windows-msvc';
 const targetRoot = path.join(path.resolve(root, env.CARGO_TARGET_DIR || 'src-tauri/target'), target, 'release');
 const prebuiltBinary = path.join(targetRoot, 'md2chat');
 if (prebuilt) {
  requireNonemptyFile(prebuiltBinary, 'prebuilt universal Mac binary');
  // Downloaded Actions artifacts lose executable permissions.
  fs.chmodSync(prebuiltBinary, 0o755);
 }
 const required = testBuild ? [] : ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_UPDATER_PUBLIC_KEY'];
 if (platform === 'mac') required.push('CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID');
 const missing = required.filter(name => !env[name]?.trim());
 if (missing.length) throw new Error('Configure GitHub Actions Secrets: ' + missing.join(', '));
 const buildEnv = nativeEnv(env);
 if (platform === 'mac') Object.assign(buildEnv, {
  APPLE_SIGNING_IDENTITY: macSigningIdentity(env, root, run),
  APPLE_CERTIFICATE: env.CSC_LINK,
  APPLE_CERTIFICATE_PASSWORD: env.CSC_KEY_PASSWORD,
  APPLE_PASSWORD: env.APPLE_APP_SPECIFIC_PASSWORD
 });
 const bundle = path.join(targetRoot, 'bundle');
 const output = path.join(root, 'release');
 const command = (name, args, options = {}) => run(name, args, {cwd: root, env: buildEnv, stdio: 'inherit', ...options});
 if (prebuilt) command('lipo', [prebuiltBinary, '-verify_arch', 'arm64', 'x86_64']);
 // Remove only this target's package folders so an older bundle cannot be published.
 for (const directory of platform === 'mac' ? ['macos', 'dmg'] : ['nsis']) fs.rmSync(path.join(bundle, directory), {recursive: true, force: true});
 const config = releaseConfig(env, testBuild);
 const tauriArgs = [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), prebuilt ? 'bundle' : 'build', '--target', target, '--bundles', platform === 'mac' ? 'app' : 'nsis', '--config', JSON.stringify(config)];
 if (platform === 'mac') withMacAppStaplerGuard(buildEnv, guardedEnv => command(process.execPath, tauriArgs, {env: guardedEnv}), {realXcrun});
 else command(process.execPath, tauriArgs);
 const one = (directory, suffix) => {
  const matches = fs.readdirSync(path.join(bundle, directory)).filter(name => name.endsWith(suffix));
  if (matches.length !== 1) throw new Error('Expected one ' + suffix + ' in ' + directory);
  return path.join(bundle, directory, matches[0]);
 };
 const assets = [];
 if (platform === 'mac') {
  const app = one('macos', '.app');
  command('lipo', [path.join(app, 'Contents/MacOS/md2chat'), '-verify_arch', 'arm64', 'x86_64']);
  command('codesign', ['--verify', '--deep', '--strict', app]);
  command('spctl', ['--assess', '--type', 'execute', '--verbose', app]);
  checkedStapler(command, 'validate', app, sleep);
  const dmgDirectory = path.join(bundle, 'dmg');
  const dmg = path.join(dmgDirectory, 'md2chat.dmg');
  const dmgSettings = path.join(root, 'desktop/dmg/settings.py');
  const dmgBackground = path.join(root, 'desktop/dmg/background.png');
  requireNonemptyFile(dmgSettings, 'DMG layout settings');
  requireNonemptyFile(dmgBackground, 'DMG background');
  requireNonemptyFile(path.join(root, 'desktop/dmg/background@2x.png'), 'Retina DMG background');
  fs.mkdirSync(dmgDirectory, {recursive: true});
  command(env.DMGBUILD_PYTHON?.trim() || 'python3', ['-m', 'dmgbuild', '-s', dmgSettings,
   '-D', 'app=' + app, '-D', 'background=' + dmgBackground, 'md2chat', dmg], {env: dmgBuildEnv(buildEnv)});
  requireNonemptyFile(dmg, 'Mac DMG');
  // Tauri removes the temporary keychain created from APPLE_CERTIFICATE when
  // its process exits, so import the same P12 into a short-lived keychain for
  // the separately generated DMG and explicitly select that keychain.
  signMacDmg(command, env, buildEnv.APPLE_SIGNING_IDENTITY, dmg);
  command('codesign', ['--verify', '--strict', dmg]);
  // Tauri notarizes and staples the .app. The custom DMG is signed above,
  // then submitted and stapled independently here.
  // Capture notarytool output so credentials or service diagnostics never reach
  // build logs. Do not include its argv or underlying errors in our failures.
  let notarization;
  try {
   const result = command('xcrun', ['notarytool', 'submit', dmg,
    '--apple-id', buildEnv.APPLE_ID, '--password', buildEnv.APPLE_PASSWORD,
    '--team-id', buildEnv.APPLE_TEAM_ID, '--wait', '--timeout', '30m', '--output-format', 'json'],
   {stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'});
   notarization = JSON.parse(result.stdout);
  } catch {
   throw new Error('DMG notarization failed; no release artifacts were copied');
  }
  if (notarization?.status !== 'Accepted') throw new Error('DMG notarization was not Accepted; no release artifacts were copied');
  checkedStapler(command, 'staple', dmg, sleep);
  checkedStapler(command, 'validate', dmg, sleep);
  assets.push([dmg, 'md2chat-mac-universal.dmg']);
  if (!testBuild) assets.push([one('macos', '.app.tar.gz'), 'md2chat-mac-universal.app.tar.gz']);
 } else assets.push([one('nsis', '-setup.exe'), 'md2chat-windows-x64-setup.exe']);
 for (const [source, name] of testBuild ? [] : assets.filter(([, name]) => !name.endsWith('.dmg'))) {
  const signature = fs.readFileSync(source + '.sig', 'utf8').trim();
  verifyUpdaterSignature(fs.readFileSync(source), signature, env.TAURI_UPDATER_PUBLIC_KEY.trim());
  assets.push([source + '.sig', name + '.sig']);
 }
 fs.mkdirSync(output, {recursive: true});
 for (const [source, name] of assets) {
  if (!fs.statSync(source).size) throw new Error('Empty release asset: ' + name);
  fs.copyFileSync(source, path.join(output, name));
 }
 return assets.map(([, name]) => name);
}
function runCommand(command, args, options) {
 const {allowFailure = false, ...spawnOptions} = options;
 const result = spawnSync(command, args, spawnOptions);
 if (result.error) throw result.error;
 if (result.status !== 0 && !allowFailure) throw new Error(command + ' failed with status ' + result.status);
 return result;
}
if (require.main === module && process.argv[2] === '--guard-app-stapler') {
 process.exitCode = runGuardedAppStapler(process.argv.slice(3));
}
else if (require.main === module) {
 const [platform, arch, ...extra] = process.argv.slice(2);
 const flags = new Set(extra);
 const validFlags = new Set(['--test-build', '--compile-only', '--prebuilt']);
 if (flags.size !== extra.length || [...flags].some(flag => !validFlags.has(flag)) || (flags.has('--compile-only') && flags.has('--prebuilt'))) {
  throw new Error('Invalid build arguments: use mac universal or win x64, optionally --test-build; mac arm64|x64 --compile-only; or mac universal --prebuilt');
 }
 const testBuild = flags.has('--test-build');
 if (flags.has('--compile-only')) {
  if (platform !== 'mac') throw new Error('Invalid build arguments: --compile-only is allowed only for mac arm64 or mac x64');
  buildMacBinary(arch, {testBuild});
 }
 else buildRelease(platform, arch, {testBuild, prebuilt: flags.has('--prebuilt')});
}
module.exports = {buildMacBinary, buildRelease, runGuardedAppStapler};
