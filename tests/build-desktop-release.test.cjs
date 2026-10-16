const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {buildRelease} = require('../scripts/build-desktop-release.cjs');
const {signingFixture} = require('./helpers/updater.cjs');
const appleSecrets = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
function fixture(callback) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-tauri-build-'));
 const signing = signingFixture();
 const env = {...Object.fromEntries(appleSecrets.map(name => [name, 'fixture'])), APPLE_SIGNING_IDENTITY: 'Developer ID Application: Test Team (0123456789)', TAURI_SIGNING_PRIVATE_KEY: 'not-used-in-test', TAURI_UPDATER_PUBLIC_KEY: signing.publicKey};
 const calls = [];
 function run(command, args, options) {
  calls.push({command, args, options});
  if (!args.includes('build')) return;
  const target = args[args.indexOf('--target') + 1], bundle = path.join(root, 'src-tauri/target', target, 'release/bundle');
  const files = target.startsWith('universal') ? ['macos/md2chat.app/Contents/MacOS/md2chat', 'macos/md2chat.app.tar.gz', 'dmg/md2chat_0.6.6_universal.dmg'] : ['nsis/md2chat_0.6.6_x64-setup.exe'];
  for (const name of files) {
   const file = path.join(bundle, name), data = Buffer.from(name);
   fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data);
   if (name.endsWith('.gz') || name.endsWith('.exe')) fs.writeFileSync(file + '.sig', signing.sign(data));
  }
 }
 try { callback({root, env, calls, run}); } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
test('Mac release builds Tauri universal app, verifies signature and notarization, then normalizes artifact names', () => fixture(({root, env, calls, run}) => {
 const assets = buildRelease('mac', 'universal', {root, env, run});
 assert.deepEqual(assets, ['md2chat-mac-universal.dmg', 'md2chat-mac-universal.app.tar.gz', 'md2chat-mac-universal.app.tar.gz.sig']);
 const build = calls[0];
 assert(build.args.includes('universal-apple-darwin')); assert(build.args.includes('app,dmg'));
 const config = JSON.parse(build.args.at(-1)); assert.equal(config.plugins.updater.pubkey, env.TAURI_UPDATER_PUBLIC_KEY);
 assert.equal(build.options.env.APPLE_CERTIFICATE, env.CSC_LINK); assert.equal(build.options.env.APPLE_PASSWORD, env.APPLE_APP_SPECIFIC_PASSWORD);
 assert.deepEqual(calls.slice(1).map(call => call.command), ['lipo', 'codesign', 'spctl', 'xcrun', 'xcrun']);
 assert.deepEqual(calls[1].args.slice(-3), ['-verify_arch', 'arm64', 'x86_64']);
 for (const name of assets) assert(fs.statSync(path.join(root, 'release', name)).size);
}));
test('Windows NSIS release uses the signed installer itself as updater artifact', () => fixture(({root, env, calls, run}) => {
 for (const name of appleSecrets) delete env[name];
 assert.deepEqual(buildRelease('win', 'x64', {root, env, run}), ['md2chat-windows-x64-setup.exe', 'md2chat-windows-x64-setup.exe.sig']);
 assert.equal(calls.length, 1); assert(calls[0].args.includes('x86_64-pc-windows-msvc')); assert(calls[0].args.includes('nsis'));
}));
test('invalid targets, missing credentials, and ad hoc identities fail before building', () => fixture(({root, env, run, calls}) => {
 for (const [platform, arch] of [['mac', 'arm64'], ['win', 'arm64'], ['linux', 'x64'], []]) assert.throws(() => buildRelease(platform, arch, {root, env, run}), /Invalid build target/);
 for (const name of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_UPDATER_PUBLIC_KEY', ...appleSecrets]) {
  const incomplete = {...env}; delete incomplete[name]; assert.throws(() => buildRelease('mac', 'universal', {root, env: incomplete, run}), new RegExp(name));
 }
 assert.throws(() => buildRelease('mac', 'universal', {root, env: {...env, APPLE_SIGNING_IDENTITY: '-'}, run}), /Developer ID/);
 assert.equal(calls.length, 0);
}));
test('build failures and signature mismatches never copy publishable artifacts', () => fixture(({root, env, run}) => {
 assert.throws(() => buildRelease('mac', 'universal', {root, env, run() {throw new Error('builder failed');}}), /builder failed/);
 assert(!fs.existsSync(path.join(root, 'release')));
 assert.throws(() => buildRelease('win', 'x64', {root, env: {...env, TAURI_UPDATER_PUBLIC_KEY: signingFixture().publicKey}, run}), /signature/);
 assert(!fs.existsSync(path.join(root, 'release')));
}));
