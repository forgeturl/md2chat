const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {buildMacBinary, buildRelease, runGuardedAppStapler} = require('../scripts/build-desktop-release.cjs');
const {signingFixture} = require('./helpers/updater.cjs');
const appleSecrets = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
// Public self-signed certificate used only to exercise CN extraction. Its private
// key was discarded; production trust is enforced by codesign and Gatekeeper.
const developerCertificate = `-----BEGIN CERTIFICATE-----
MIIB7jCCAZSgAwIBAgIJAKuYHMGMGT/VMAoGCCqGSM49BAMCMFIxOTA3BgNVBAMM
MERldmVsb3BlciBJRCBBcHBsaWNhdGlvbjogVGVzdCBUZWFtICgwMTIzNDU2Nzg5
KTEVMBMGA1UECgwMbWQyY2hhdCBUZXN0MB4XDTI2MTAxNjE5MDEyMVoXDTI2MTEx
NTE5MDEyMVowUjE5MDcGA1UEAwwwRGV2ZWxvcGVyIElEIEFwcGxpY2F0aW9uOiBU
ZXN0IFRlYW0gKDAxMjM0NTY3ODkpMRUwEwYDVQQKDAxtZDJjaGF0IFRlc3QwWTAT
BgcqhkjOPQIBBggqhkjOPQMBBwNCAAR2jL/Pehm/gKDNvWpmWs6JpdXbbLOmibXL
yW28GZeyoNAX164aBi3cE1XyQ6DAO+JTbUrQDO643bZvuKx7eL1Ro1MwUTAdBgNV
HQ4EFgQU6dgbDIkrwGWuRFFf5aYbzv5kyw0wHwYDVR0jBBgwFoAU6dgbDIkrwGWu
RFFf5aYbzv5kyw0wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiAo
o0LiVM5CiN0G38rb+0NZobsuPHzM8PWi+us3yIqFLAIhAJBnMaF6PukgNKhyvB1b
npg+a4SJNLXwa4VlZ8IbG288
-----END CERTIFICATE-----`;
function fixture(callback) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-tauri-build-'));
 const dmgResources = path.join(root, 'desktop/dmg');
 fs.mkdirSync(dmgResources, {recursive: true});
 for (const name of ['settings.py', 'background.png', 'background@2x.png']) {
  fs.copyFileSync(path.resolve(__dirname, '../desktop/dmg', name), path.join(dmgResources, name));
 }
 const signing = signingFixture();
 const env = {...Object.fromEntries(appleSecrets.map(name => [name, 'fixture'])), APPLE_SIGNING_IDENTITY: 'Developer ID Application: Test Team (0123456789)', TAURI_SIGNING_PRIVATE_KEY: 'not-used-in-test', TAURI_UPDATER_PUBLIC_KEY: signing.publicKey};
 env.CSC_LINK = Buffer.from('fixture-p12').toString('base64');
 const calls = [];
 const guards = [];
 function run(command, args, options) {
  calls.push({command, args, options});
  if (command === 'openssl') return {stdout: developerCertificate};
  if (args[0] === 'notarytool') return {stdout: JSON.stringify({status: 'Accepted'})};
  if (args[0] === '-m' && args[1] === 'dmgbuild') {
   const dmg = args.at(-1);
   fs.mkdirSync(path.dirname(dmg), {recursive: true}); fs.writeFileSync(dmg, 'custom-dmg');
   return {status: 0};
  }
  if (args[1] !== 'build' && args[1] !== 'bundle') return {status: 0};
  if (options.env?.MD2CHAT_APP_STAPLER_STATUS) {
   const directory = options.env.PATH.split(path.delimiter)[0];
   guards.push({directory, source: fs.readFileSync(path.join(directory, 'xcrun'), 'utf8')});
   fs.writeFileSync(options.env.MD2CHAT_APP_STAPLER_STATUS, 'ok\n');
  }
  const updater = JSON.parse(args.at(-1)).bundle.createUpdaterArtifacts;
  const target = args[args.indexOf('--target') + 1];
  if (args.includes('--no-bundle')) {
   const binary = path.join(root, 'src-tauri/target', target, 'release/md2chat');
   fs.mkdirSync(path.dirname(binary), {recursive: true}); fs.writeFileSync(binary, target);
   return {status: 0};
  }
  const bundle = path.join(root, 'src-tauri/target', target, 'release/bundle');
  const files = target.startsWith('universal') ? ['macos/md2chat.app/Contents/MacOS/md2chat', ...(updater ? ['macos/md2chat.app.tar.gz'] : [])] : ['nsis/md2chat_0.6.6_x64-setup.exe'];
  for (const name of files) {
   const file = path.join(bundle, name), data = Buffer.from(name);
   fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data);
   if (updater && (name.endsWith('.gz') || name.endsWith('.exe'))) fs.writeFileSync(file + '.sig', signing.sign(data));
  }
 }
 try { callback({root, env, calls, guards, run}); } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
test('Mac release builds only the Tauri app, creates and signs the guided DMG, then notarizes it', () => fixture(({root, env, calls, guards, run}) => {
 const assets = buildRelease('mac', 'universal', {root, env, run});
 assert.deepEqual(assets, ['md2chat-mac-universal.dmg', 'md2chat-mac-universal.app.tar.gz', 'md2chat-mac-universal.app.tar.gz.sig']);
 const build = calls[0];
 assert(build.args.includes('universal-apple-darwin')); assert(build.args.includes('app')); assert(!build.args.includes('app,dmg'));
 const config = JSON.parse(build.args.at(-1)); assert.equal(config.plugins.updater.pubkey, env.TAURI_UPDATER_PUBLIC_KEY);
 assert.equal(build.options.env.APPLE_CERTIFICATE, env.CSC_LINK); assert.equal(build.options.env.APPLE_PASSWORD, env.APPLE_APP_SPECIFIC_PASSWORD);
 assert.equal(guards.length, 1); assert.match(guards[0].source, /--guard-app-stapler/);
 assert.match(guards[0].source, /exec "\$MD2CHAT_REAL_XCRUN"/);
 assert(!guards[0].source.includes(env.APPLE_APP_SPECIFIC_PASSWORD)); assert(!fs.existsSync(guards[0].directory));
 assert.deepEqual(calls.slice(1).map(call => call.command), ['lipo', 'codesign', 'spctl', 'xcrun', 'python3',
  'security', 'security', 'security', 'security', 'security', 'codesign', 'security', 'codesign', 'xcrun', 'xcrun', 'xcrun']);
 assert.deepEqual(calls[1].args.slice(-3), ['-verify_arch', 'arm64', 'x86_64']);
 const app = path.join(root, 'src-tauri/target/universal-apple-darwin/release/bundle/macos/md2chat.app');
 const dmg = path.join(root, 'src-tauri/target/universal-apple-darwin/release/bundle/dmg/md2chat.dmg');
 assert.deepEqual(calls[4].args, ['stapler', 'validate', app]);
 assert.deepEqual(calls[5].args, ['-m', 'dmgbuild', '-s', path.join(root, 'desktop/dmg/settings.py'),
  '-D', 'app=' + app, '-D', 'background=' + path.join(root, 'desktop/dmg/background.png'), 'md2chat', dmg]);
 const keychain = calls[6].args.at(-1), keychainPassword = calls[6].args[2];
 assert.deepEqual(calls[6].args, ['create-keychain', '-p', keychainPassword, keychain]);
 assert.deepEqual(calls[7].args, ['unlock-keychain', '-p', keychainPassword, keychain]);
 assert.deepEqual(calls[8].args, ['import', path.join(path.dirname(keychain), 'certificate.p12'),
  '-f', 'pkcs12', '-t', 'agg', '-k', keychain, '-P', env.CSC_KEY_PASSWORD, '-T', '/usr/bin/codesign']);
 assert.deepEqual(calls[9].args, ['set-keychain-settings', '-t', '3600', '-u', keychain]);
 assert.deepEqual(calls[10].args, ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain]);
 for (const call of calls.slice(6, 11)) assert.deepEqual(call.options.stdio, ['ignore', 'pipe', 'pipe']);
 assert.deepEqual(calls[11].args, ['--force', '--sign', env.APPLE_SIGNING_IDENTITY, '--keychain', keychain, '--timestamp', dmg]);
 assert.deepEqual(calls[12].args, ['delete-keychain', keychain]);
 assert.equal(calls[12].options.allowFailure, true); assert(!fs.existsSync(path.dirname(keychain)));
 assert.deepEqual(calls[13].args, ['--verify', '--strict', dmg]);
 assert.deepEqual(calls[14].args, ['notarytool', 'submit', dmg, '--apple-id', env.APPLE_ID,
  '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID,
  '--wait', '--timeout', '30m', '--output-format', 'json']);
 assert.deepEqual(calls[14].options.stdio, ['ignore', 'pipe', 'pipe']);
 assert.equal(calls[14].options.encoding, 'utf8');
 assert.deepEqual(calls[15].args, ['stapler', 'staple', dmg]);
 assert.deepEqual(calls[16].args, ['stapler', 'validate', dmg]);
 for (const name of assets) assert(fs.statSync(path.join(root, 'release', name)).size);
}));
test('Mac DMG signing uses a private temporary keychain and cleans it after failure', () => fixture(({root, env, calls, run}) => {
 const privateDiagnostic = 'private-codesign-diagnostic';
 let temporary, deleted = false;
 assert.throws(() => buildRelease('mac', 'universal', {root, env, run(command, args, options) {
  if (command === 'security' && args[0] === 'import') {
   const certificate = args[1]; temporary = path.dirname(certificate);
   assert.equal(fs.readFileSync(certificate, 'utf8'), 'fixture-p12');
   if (process.platform !== 'win32') {
    assert.equal(fs.statSync(certificate).mode & 0o777, 0o600);
    assert.equal(fs.statSync(temporary).mode & 0o777, 0o700);
   }
   assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  }
  if (command === 'codesign' && args.includes('--keychain')) throw new Error(privateDiagnostic);
  if (command === 'security' && args[0] === 'delete-keychain') deleted = true;
  return run(command, args, options);
 }}), error => /DMG signing failed/.test(error.message) && !error.message.includes(privateDiagnostic));
 assert(temporary); assert.equal(deleted, true); assert(!fs.existsSync(temporary));
 assert(!calls.some(call => call.args[0] === 'notarytool'));
 assert(!fs.existsSync(path.join(root, 'release')));
}));
test('Mac Tauri xcrun shim routes app stapling through the checked helper and delegates other tools', {skip: process.platform === 'win32'}, () => fixture(({root, env, run}) => {
 const callsFile = path.join(root, 'real-xcrun-calls');
 const realXcrun = path.join(root, 'real-xcrun');
 fs.writeFileSync(realXcrun, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MD2CHAT_FAKE_XCRUN_CALLS"\n', {mode: 0o700});
 env.MD2CHAT_FAKE_XCRUN_CALLS = callsFile;
 let exercised = false;
 buildRelease('mac', 'universal', {root, env, realXcrun, run(command, args, options) {
  if (['build', 'bundle'].includes(args[1]) && options.env?.MD2CHAT_APP_STAPLER_STATUS) {
   exercised = true;
   const shim = path.join(options.env.PATH.split(path.delimiter)[0], 'xcrun');
   const app = require('node:child_process').spawnSync('/bin/sh', [shim, 'stapler', 'staple', '-v', path.join(root, 'Fixture App.app')], {env: options.env, encoding: 'utf8'});
   assert.equal(app.status, 0); assert.equal(app.stdout, ''); assert.equal(app.stderr, '');
   const delegated = require('node:child_process').spawnSync('/bin/sh', [shim, 'notarytool', 'history'], {env: options.env, encoding: 'utf8'});
   assert.equal(delegated.status, 0);
   const unguarded = {...options, env: {...options.env}};
   delete unguarded.env.MD2CHAT_APP_STAPLER_STATUS;
   return run(command, args, unguarded);
  }
  return run(command, args, options);
 }});
 assert.equal(exercised, true);
 const forwarded = fs.readFileSync(callsFile, 'utf8').trim().split('\n');
 assert.equal(forwarded.length, 2);
 assert.match(forwarded[0], /^stapler staple -v .*Fixture App\.app$/);
 assert.equal(forwarded[1], 'notarytool history');
}));
test('guarded internal app stapler retries in place and stores no captured service diagnostic', () => {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-app-stapler-test-'));
 try {
  const marker = path.join(temporary, 'status');
  const waits = [];
  let attempts = 0;
  const privateDiagnostic = 'private-apple-service-diagnostic';
  const result = runGuardedAppStapler(['stapler', 'staple', '-v', path.join(temporary, 'md2chat.app')], {
   env: {MD2CHAT_APP_STAPLER_STATUS: marker, MD2CHAT_REAL_XCRUN: '/usr/bin/xcrun'},
   sleep: milliseconds => waits.push(milliseconds),
   run(command, args, options) {
    attempts++;
    assert.equal(command, '/usr/bin/xcrun'); assert.equal(args[0], 'stapler');
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    return attempts < 3 ? {status: 68, stderr: privateDiagnostic} : {status: 0};
   }
  });
  assert.equal(result, 0); assert.equal(attempts, 3); assert.deepEqual(waits, [5000, 10000]);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok\n');
  assert(!fs.readFileSync(marker, 'utf8').includes(privateDiagnostic));
 } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
test('guarded internal app stapler exhausts bounded retries and records only failure state', () => {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-app-stapler-test-'));
 try {
  const marker = path.join(temporary, 'status');
  const waits = [];
  let attempts = 0;
  const privateDiagnostic = 'private-apple-service-diagnostic';
  const result = runGuardedAppStapler(['stapler', 'staple', path.join(temporary, 'md2chat.app')], {
   env: {MD2CHAT_APP_STAPLER_STATUS: marker, MD2CHAT_REAL_XCRUN: '/usr/bin/xcrun'},
   sleep: milliseconds => waits.push(milliseconds),
   run() { attempts++; return {status: 68, stdout: privateDiagnostic}; }
  });
  assert.equal(result, 68); assert.equal(attempts, 3); assert.deepEqual(waits, [5000, 10000]);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'failed\n');
  assert(!fs.readFileSync(marker, 'utf8').includes(privateDiagnostic));
 } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
test('Mac packaging fails closed when Tauri does not complete guarded app stapling', () => fixture(({root, env, calls, run}) => {
 const privateDiagnostic = 'private-tauri-stapler-diagnostic';
 let guardDirectory;
 assert.throws(() => buildRelease('mac', 'universal', {root, env, run(command, args, options) {
  if (['build', 'bundle'].includes(args[1]) && options.env?.MD2CHAT_APP_STAPLER_STATUS) {
   guardDirectory = path.dirname(options.env.MD2CHAT_APP_STAPLER_STATUS);
   const unguarded = {...options, env: {...options.env}};
   delete unguarded.env.MD2CHAT_APP_STAPLER_STATUS;
   const result = run(command, args, unguarded);
   fs.writeFileSync(path.join(guardDirectory, 'captured-diagnostic'), privateDiagnostic);
   return result;
  }
  return run(command, args, options);
 }}), error => /Mac app ticket stapling failed during packaging/.test(error.message) && !error.message.includes(privateDiagnostic));
 assert(guardDirectory); assert(!fs.existsSync(guardDirectory));
 assert(!calls.some(call => call.args[0] === 'notarytool'));
 assert(!fs.existsSync(path.join(root, 'release')));
}));
test('Mac release binaries compile independently with matching updater configuration and no bundle', () => fixture(({root, env, calls, run}) => {
 const compileEnv = {TAURI_UPDATER_PUBLIC_KEY: env.TAURI_UPDATER_PUBLIC_KEY};
 for (const [arch, target] of [['arm64', 'aarch64-apple-darwin'], ['x64', 'x86_64-apple-darwin']]) {
  const binary = buildMacBinary(arch, {root, env: compileEnv, run});
  assert.equal(binary, path.join(root, 'src-tauri/target', target, 'release/md2chat'));
  assert(fs.statSync(binary).size);
  const build = calls.at(-1);
  assert.equal(build.args[1], 'build');
  assert(build.args.includes('--no-bundle')); assert(build.args.includes('--no-sign'));
  assert.equal(build.args[build.args.indexOf('--target') + 1], target);
  assert.deepEqual(JSON.parse(build.args.at(-1)), {bundle: {createUpdaterArtifacts: true}, plugins: {updater: {pubkey: env.TAURI_UPDATER_PUBLIC_KEY}}});
  for (const secret of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'TAURI_SIGNING_PRIVATE_KEY']) assert.equal(build.options.env[secret], undefined);
 }
}));
test('prebuilt Mac release bundles an existing universal binary without rebuilding Rust', () => fixture(({root, env, calls, run}) => {
 const binary = path.join(root, 'src-tauri/target/universal-apple-darwin/release/md2chat');
 fs.mkdirSync(path.dirname(binary), {recursive: true}); fs.writeFileSync(binary, 'universal-binary');
 const assets = buildRelease('mac', 'universal', {root, env, run, prebuilt: true});
 assert.deepEqual(assets, ['md2chat-mac-universal.dmg', 'md2chat-mac-universal.app.tar.gz', 'md2chat-mac-universal.app.tar.gz.sig']);
 const tauri = calls.find(call => call.args[1] === 'bundle');
 assert(tauri); assert(!calls.some(call => call.args[1] === 'build'));
 assert.deepEqual(JSON.parse(tauri.args.at(-1)), {bundle: {createUpdaterArtifacts: true}, plugins: {updater: {pubkey: env.TAURI_UPDATER_PUBLIC_KEY}}});
 assert(calls.some(call => call.command === 'lipo' && call.args[0] === binary && call.args.includes('-verify_arch')));
 if (process.platform !== 'win32') assert(fs.statSync(binary).mode & 0o111);
}));
test('prebuilt Mac release refuses a missing or empty universal binary before bundling', () => fixture(({root, env, calls, run}) => {
 const binary = path.join(root, 'src-tauri/target/universal-apple-darwin/release/md2chat');
 for (const contents of [null, '']) {
  fs.rmSync(binary, {force: true});
  if (contents !== null) {fs.mkdirSync(path.dirname(binary), {recursive: true}); fs.writeFileSync(binary, contents);}
  assert.throws(() => buildRelease('mac', 'universal', {root, env, run, prebuilt: true}), /prebuilt universal Mac binary/i);
 }
 assert(!calls.some(call => call.args[1] === 'bundle'));
 assert(!fs.existsSync(path.join(root, 'release')));
}));
test('prebuilt Mac release verifies both architectures before invoking the bundler', () => fixture(({root, env, calls, run}) => {
 const binary = path.join(root, 'src-tauri/target/universal-apple-darwin/release/md2chat');
 fs.mkdirSync(path.dirname(binary), {recursive: true}); fs.writeFileSync(binary, 'wrong-architecture');
 assert.throws(() => buildRelease('mac', 'universal', {root, env, prebuilt: true, run(command, args, options) {
  if (command === 'lipo' && args[0] === binary) throw new Error('architecture mismatch');
  return run(command, args, options);
 }}), /architecture mismatch/);
 assert(!calls.some(call => call.args[1] === 'bundle'));
 assert(!fs.existsSync(path.join(root, 'release')));
}));
test('manual Mac binary builds use the same disabled updater configuration as final packaging', () => fixture(({root, env, calls, run}) => {
 const compileEnv = {GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch'};
 buildMacBinary('arm64', {root, env: compileEnv, run, testBuild: true});
 const binary = path.join(root, 'src-tauri/target/universal-apple-darwin/release/md2chat');
 fs.mkdirSync(path.dirname(binary), {recursive: true}); fs.writeFileSync(binary, 'universal-binary');
 buildRelease('mac', 'universal', {root, env: {...env, ...compileEnv}, run, testBuild: true, prebuilt: true});
 const configs = calls.filter(call => ['build', 'bundle'].includes(call.args[1])).map(call => JSON.parse(call.args.at(-1)));
 assert.equal(configs.length, 2); assert.deepEqual(configs[0], configs[1]);
 assert.deepEqual(configs[0], {bundle: {createUpdaterArtifacts: false}, plugins: {updater: {pubkey: ''}}});
}));
test('Windows NSIS release uses the signed installer itself as updater artifact', () => fixture(({root, env, calls, run}) => {
 for (const name of appleSecrets) delete env[name];
 assert.deepEqual(buildRelease('win', 'x64', {root, env, run}), ['md2chat-windows-x64-setup.exe', 'md2chat-windows-x64-setup.exe.sig']);
 assert.equal(calls.length, 1); assert(calls[0].args.includes('x86_64-pc-windows-msvc')); assert(calls[0].args.includes('nsis'));
}));
test('Mac derives an omitted signing identity from a private temporary P12 and cleans it up', () => fixture(({root, env, calls, run}) => {
 delete env.APPLE_SIGNING_IDENTITY;
 env.CSC_LINK = Buffer.from('encrypted-p12-test').toString('base64');
 let temporary;
 buildRelease('mac', 'universal', {root, env, run(command, args, options) {
  if (command === 'openssl') {
   temporary = args[args.indexOf('-in') + 1];
   assert.equal(fs.readFileSync(temporary, 'utf8'), 'encrypted-p12-test');
   if (process.platform !== 'win32') {
    assert.equal(fs.statSync(temporary).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(temporary)).mode & 0o777, 0o700);
   }
   assert.deepEqual(args.slice(3), ['-clcerts', '-nokeys', '-passin', 'env:CSC_KEY_PASSWORD']);
   assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
   assert(!args.includes(env.CSC_KEY_PASSWORD));
  }
  return run(command, args, options);
 }});
 assert(temporary); assert(!fs.existsSync(path.dirname(temporary)));
 assert.equal(calls.find(call => call.args.includes('build')).options.env.APPLE_SIGNING_IDENTITY, 'Developer ID Application: Test Team (0123456789)');
}));
test('Mac retries legacy P12 extraction without exposing the underlying error', () => fixture(({root, env, run}) => {
 delete env.APPLE_SIGNING_IDENTITY;
 env.CSC_LINK = Buffer.from('encrypted-p12-test').toString('base64');
 let attempts = 0;
 buildRelease('mac', 'universal', {root, env, run(command, args, options) {
  if (command === 'openssl' && ++attempts === 1) throw new Error('private OpenSSL diagnostic');
  if (command === 'openssl') assert.equal(args.at(-1), '-legacy');
  return run(command, args, options);
 }});
 assert.equal(attempts, 2);
}));
test('Mac fails closed on ambiguous, unrelated, malformed, or unreadable certificates and cleans temporary files', () => fixture(({root, env, run}) => {
 delete env.APPLE_SIGNING_IDENTITY;
 env.CSC_LINK = Buffer.from('encrypted-p12-test').toString('base64');
 const raw = new (require('node:crypto').X509Certificate)(developerCertificate).raw;
 const unrelated = '-----BEGIN CERTIFICATE-----\n' + Buffer.from(raw.toString('latin1').replaceAll('Developer ID Application', 'Developer ID Unsupported'), 'latin1').toString('base64') + '\n-----END CERTIFICATE-----';
 const secret = 'private-certificate-diagnostic';
 for (const response of [
  () => ({stdout: developerCertificate + '\n' + developerCertificate}),
  () => ({stdout: unrelated}),
  () => ({stdout: 'invalid certificate ' + secret}),
  () => {throw new Error('OpenSSL failed with password=' + secret);}
 ]) {
  const paths = [];
  assert.throws(() => buildRelease('mac', 'universal', {root, env, run(command, args, options) {
   if (command === 'openssl') {paths.push(args[args.indexOf('-in') + 1]); return response();}
   return run(command, args, options);
  }}), error => /Cannot derive exactly one Developer ID Application identity/.test(error.message) && !error.message.includes(secret));
  assert(paths.length); for (const file of paths) assert(!fs.existsSync(path.dirname(file)));
  assert(!fs.existsSync(path.join(root, 'release')));
 }
}));
test('manual test builds omit updater keys and artifacts while preserving Mac signing and notarization', () => fixture(({root, env, calls, run}) => {
 delete env.TAURI_SIGNING_PRIVATE_KEY; delete env.TAURI_UPDATER_PUBLIC_KEY;
 Object.assign(env, {GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch'});
 assert.deepEqual(buildRelease('mac', 'universal', {root, env, run, testBuild: true}), ['md2chat-mac-universal.dmg']);
 assert.deepEqual(JSON.parse(calls[0].args.at(-1)), {bundle: {createUpdaterArtifacts: false}, plugins: {updater: {pubkey: ''}}});
 assert(calls.some(call => call.args[0] === 'notarytool'));
 assert(calls.some(call => call.args[0] === 'stapler' && call.args[1] === 'validate' && call.args[2].endsWith('.dmg')));
 assert.deepEqual(fs.readdirSync(path.join(root, 'release')), ['md2chat-mac-universal.dmg']);
 assert.throws(() => buildRelease('mac', 'universal', {root, env: {...env, APPLE_ID: ''}, run, testBuild: true}), /APPLE_ID/);
}));
test('Windows test builds require no Apple or updater credentials and emit only the installer', () => fixture(({root, calls, run}) => {
 assert.deepEqual(buildRelease('win', 'x64', {root, env: {}, run, testBuild: true}), ['md2chat-windows-x64-setup.exe']);
 assert.equal(calls.length, 1);
 assert.equal(JSON.parse(calls[0].args.at(-1)).bundle.createUpdaterArtifacts, false);
 assert.deepEqual(fs.readdirSync(path.join(root, 'release')), ['md2chat-windows-x64-setup.exe']);
}));
test('test builds cannot downgrade a GitHub tag build and unknown CLI flags are rejected', () => fixture(({root, env, run, calls}) => {
 assert.throws(() => buildRelease('mac', 'universal', {root, env: {...env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push'}, run, testBuild: true}), /only for workflow_dispatch/);
 assert.throws(() => buildMacBinary('arm64', {root, env: {GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push'}, run, testBuild: true}), /only for workflow_dispatch/);
 assert.equal(calls.length, 0);
 for (const args of [['win', 'x64', '--unknown'], ['win', 'x64', '--test-build', '--test-build'], ['win', 'x64', '--compile-only', '--test-build'], ['mac', 'universal', '--compile-only', '--prebuilt']]) {
  const result = require('node:child_process').spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/build-desktop-release.cjs'), ...args], {encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Invalid build arguments/);
 }
}));
test('invalid targets, missing credentials, and ad hoc identities fail before building', () => fixture(({root, env, run, calls}) => {
 for (const [platform, arch] of [['mac', 'arm64'], ['win', 'arm64'], ['linux', 'x64'], []]) assert.throws(() => buildRelease(platform, arch, {root, env, run}), /Invalid build target/);
 for (const arch of ['universal', 'x86', '', undefined]) assert.throws(() => buildMacBinary(arch, {root, env, run}), /Invalid Mac binary target/);
 assert.throws(() => buildMacBinary('arm64', {root, env: {}, run}), /TAURI_UPDATER_PUBLIC_KEY/);
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
test('DMG notarization failures stop before stapling or copying and do not expose diagnostics', () => fixture(({root, env, run}) => {
 const secret = 'private-service-diagnostic';
 for (const response of [
  () => ({stdout: 'invalid JSON ' + secret}),
  () => ({stdout: JSON.stringify({status: 'Invalid', detail: secret})}),
  () => ({stdout: JSON.stringify({status: 'In Progress'})}),
  () => {throw new Error('spawn failed with password=' + secret);}
 ]) {
  let stapled = false;
  assert.throws(() => buildRelease('mac', 'universal', {root, env, run(command, args, options) {
   if (args[0] === 'notarytool') return response();
   if (args[0] === 'stapler' && args[1] === 'staple') stapled = true;
   return run(command, args, options);
  }}), error => /DMG notarization/.test(error.message) && !error.message.includes(secret));
  assert.equal(stapled, false);
  assert(!fs.existsSync(path.join(root, 'release')));
 }
}));
test('DMG stapling and ticket validation failures never copy publishable artifacts', () => fixture(({root, env, run}) => {
 for (const operation of ['staple', 'validate']) {
  assert.throws(() => buildRelease('mac', 'universal', {root, env, run(command, args, options) {
   if (args[0] === 'stapler' && args[1] === operation && args[2].endsWith('.dmg')) throw new Error('DMG ticket failed');
   return run(command, args, options);
  }}), /Mac ticket .* failed/);
  assert(!fs.existsSync(path.join(root, 'release')));
 }
}));
test('accepted Mac artifacts retry transient ticket network failures without rebuilding or resubmitting', () => {
 for (const [operation, suffix] of [['validate', '.app'], ['staple', '.dmg'], ['validate', '.dmg']]) fixture(({root, env, calls, run}) => {
  let attempts = 0;
  const waits = [];
  const assets = buildRelease('mac', 'universal', {root, env, sleep: milliseconds => waits.push(milliseconds), run(command, args, options) {
   if (args[0] === 'stapler' && args[1] === operation && args[2].endsWith(suffix)) {
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.allowFailure, true);
    if (++attempts < 3) return {status: 68, stderr: 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."'};
   }
   return run(command, args, options);
  }});
  assert.equal(attempts, 3); assert.deepEqual(waits, [5000, 10000]);
  assert.equal(calls.filter(call => call.args.includes('build')).length, 1);
  assert.equal(calls.filter(call => call.args[0] === 'notarytool').length, 1);
  assert(calls.some(call => call.args[0] === 'stapler' && call.args[1] === 'validate' && call.args[2].endsWith('.dmg')));
  for (const name of assets) assert(fs.statSync(path.join(root, 'release', name)).size);
 });
});
test('persistent ticket service failures exhaust bounded retries before copying any asset', () => fixture(({root, env, calls, run}) => {
 let attempts = 0;
 const waits = [];
 const privateDiagnostic = 'private-ticket-service-diagnostic';
 assert.throws(() => buildRelease('mac', 'universal', {root, env, sleep: milliseconds => waits.push(milliseconds), run(command, args, options) {
  if (args[0] === 'stapler' && args[1] === 'staple') {
   attempts++;
   return {status: 68, stdout: 'Error Domain=NSURLErrorDomain Code=-1001 "The request timed out." ' + privateDiagnostic};
  }
  return run(command, args, options);
 }}), error => /Mac ticket stapling failed/.test(error.message) && !error.message.includes(privateDiagnostic));
 assert.equal(attempts, 3); assert.deepEqual(waits, [5000, 10000]);
 assert.equal(calls.filter(call => call.args[0] === 'notarytool').length, 1);
 assert(!fs.existsSync(path.join(root, 'release')));
}));
test('ticket failures without the matching transient network diagnosis fail immediately and hide diagnostics', () => {
 const privateDiagnostic = 'private-ticket-service-diagnostic';
 for (const failure of [
  {status: 68, stderr: 'The path has not been previously notarized. ' + privateDiagnostic},
  {status: 68, stderr: 'Error Domain=NSURLErrorDomain Code=-1200 ' + privateDiagnostic},
  {status: 65, stderr: 'Error Domain=NSURLErrorDomain Code=-1005 ' + privateDiagnostic},
  {status: 77, stderr: 'The ticket has been revoked. ' + privateDiagnostic},
  {status: null, signal: 'SIGTERM', stderr: privateDiagnostic},
  new Error(privateDiagnostic)
 ]) fixture(({root, env, run}) => {
  let attempts = 0;
  const waits = [];
  assert.throws(() => buildRelease('mac', 'universal', {root, env, sleep: milliseconds => waits.push(milliseconds), run(command, args, options) {
   if (args[0] === 'stapler' && args[1] === 'staple') {
    attempts++;
    if (failure instanceof Error) throw failure;
    return failure;
   }
   return run(command, args, options);
  }}), error => /Mac ticket stapling failed/.test(error.message) && !error.message.includes(privateDiagnostic));
  assert.equal(attempts, 1); assert.deepEqual(waits, []);
  assert(!fs.existsSync(path.join(root, 'release')));
 });
});
