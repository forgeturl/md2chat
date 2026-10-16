const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {verifyUpdaterSignature} = require('./update-manifests.cjs');
const {nativeEnv} = require('./native-env.cjs');

function buildRelease(platform, arch, {env = process.env, root = path.resolve(__dirname, '..'), run = runCommand} = {}) {
 if (!((platform === 'mac' && arch === 'universal') || (platform === 'win' && arch === 'x64'))) throw new Error('Invalid build target: use mac universal or win x64');
 const required = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_UPDATER_PUBLIC_KEY'];
 if (platform === 'mac') required.push('CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID');
 const missing = required.filter(name => !env[name]?.trim());
 if (missing.length) throw new Error('Configure GitHub Actions Secrets: ' + missing.join(', '));
 if (platform === 'mac' && !/^Developer ID Application: .+\([A-Z0-9]{10}\)$/.test(env.APPLE_SIGNING_IDENTITY)) throw new Error('APPLE_SIGNING_IDENTITY must be a Developer ID Application identity');
 const buildEnv = nativeEnv(env);
 if (platform === 'mac') Object.assign(buildEnv, {
  APPLE_CERTIFICATE: env.CSC_LINK,
  APPLE_CERTIFICATE_PASSWORD: env.CSC_KEY_PASSWORD,
  APPLE_PASSWORD: env.APPLE_APP_SPECIFIC_PASSWORD
 });
 const target = platform === 'mac' ? 'universal-apple-darwin' : 'x86_64-pc-windows-msvc';
 const bundle = path.join(path.resolve(root, env.CARGO_TARGET_DIR || 'src-tauri/target'), target, 'release', 'bundle');
 const output = path.join(root, 'release');
 const command = (name, args) => run(name, args, {cwd: root, env: buildEnv, stdio: 'inherit'});
 // Remove only this target's package folders so an older bundle cannot be published.
 for (const directory of platform === 'mac' ? ['macos', 'dmg'] : ['nsis']) fs.rmSync(path.join(bundle, directory), {recursive: true, force: true});
 const config = {bundle: {createUpdaterArtifacts: true}, plugins: {updater: {pubkey: env.TAURI_UPDATER_PUBLIC_KEY.trim()}}};
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
  command('xcrun', ['stapler', 'validate', dmg]);
  assets.push([dmg, 'md2chat-mac-universal.dmg'], [one('macos', '.app.tar.gz'), 'md2chat-mac-universal.app.tar.gz']);
 } else assets.push([one('nsis', '-setup.exe'), 'md2chat-windows-x64-setup.exe']);
 for (const [source, name] of assets.filter(([, name]) => !name.endsWith('.dmg'))) {
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
}
if (require.main === module) {
 const [platform, arch, ...extra] = process.argv.slice(2);
 if (extra.length) throw new Error('Invalid build target: use mac universal or win x64');
 buildRelease(platform, arch);
}
module.exports = {buildRelease};
