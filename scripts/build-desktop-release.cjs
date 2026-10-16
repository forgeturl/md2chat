const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {X509Certificate} = require('node:crypto');
const {verifyUpdaterSignature} = require('./update-manifests.cjs');
const {nativeEnv} = require('./native-env.cjs');
const developerId = /^Developer ID Application: .+\([A-Z0-9]{10}\)$/;

function macSigningIdentity(env, root, run) {
 const explicit = env.APPLE_SIGNING_IDENTITY?.trim();
 if (explicit) {
  if (!developerId.test(explicit)) throw new Error('APPLE_SIGNING_IDENTITY must be a Developer ID Application identity');
  return explicit;
 }
 let temporary;
 try {
  const encoded = env.CSC_LINK.replace(/\s/g, '');
  if (encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error();
  const archive = Buffer.from(encoded, 'base64');
  if (!archive.length || archive.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error();
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-signing-'));
  fs.chmodSync(temporary, 0o700);
  const file = path.join(temporary, 'certificate.p12');
  fs.writeFileSync(file, archive, {mode: 0o600, flag: 'wx'});
  archive.fill(0);
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

function buildRelease(platform, arch, {env = process.env, root = path.resolve(__dirname, '..'), run = runCommand, testBuild = false} = {}) {
 if (!((platform === 'mac' && arch === 'universal') || (platform === 'win' && arch === 'x64'))) throw new Error('Invalid build target: use mac universal or win x64');
 if (testBuild && env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('--test-build is allowed only for workflow_dispatch in GitHub Actions');
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
 const target = platform === 'mac' ? 'universal-apple-darwin' : 'x86_64-pc-windows-msvc';
 const bundle = path.join(path.resolve(root, env.CARGO_TARGET_DIR || 'src-tauri/target'), target, 'release', 'bundle');
 const output = path.join(root, 'release');
 const command = (name, args, options = {}) => run(name, args, {cwd: root, env: buildEnv, stdio: 'inherit', ...options});
 // Remove only this target's package folders so an older bundle cannot be published.
 for (const directory of platform === 'mac' ? ['macos', 'dmg'] : ['nsis']) fs.rmSync(path.join(bundle, directory), {recursive: true, force: true});
 const config = {bundle: {createUpdaterArtifacts: !testBuild}, plugins: {updater: {pubkey: testBuild ? '' : env.TAURI_UPDATER_PUBLIC_KEY.trim()}}};
 command(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--target', target, '--bundles', platform === 'mac' ? 'app,dmg' : 'nsis', '--config', JSON.stringify(config)]);
 const one = (directory, suffix) => {
  const matches = fs.readdirSync(path.join(bundle, directory)).filter(name => name.endsWith(suffix));
  if (matches.length !== 1) throw new Error('Expected one ' + suffix + ' in ' + directory);
  return path.join(bundle, directory, matches[0]);
 };
 const assets = [];
 if (platform === 'mac') {
  const app = one('macos', '.app');
  const dmg = one('dmg', '.dmg');
  command('lipo', [path.join(app, 'Contents/MacOS/md2chat'), '-verify_arch', 'arm64', 'x86_64']);
  command('codesign', ['--verify', '--deep', '--strict', app]);
  command('spctl', ['--assess', '--type', 'execute', '--verbose', app]);
  command('xcrun', ['stapler', 'validate', app]);
  command('codesign', ['--verify', '--strict', dmg]);
  // Tauri notarizes and staples the .app, but only signs the enclosing DMG.
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
  command('xcrun', ['stapler', 'staple', dmg]);
  command('xcrun', ['stapler', 'validate', dmg]);
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
 const result = spawnSync(command, args, options);
 if (result.error) throw result.error;
 if (result.status !== 0) throw new Error(command + ' failed with status ' + result.status);
 return result;
}
if (require.main === module) {
 const [platform, arch, ...extra] = process.argv.slice(2);
 if (extra.length > 1 || (extra.length && extra[0] !== '--test-build')) throw new Error('Invalid build arguments: use mac universal or win x64, optionally --test-build');
 buildRelease(platform, arch, {testBuild: extra[0] === '--test-build'});
}
module.exports = {buildRelease};
