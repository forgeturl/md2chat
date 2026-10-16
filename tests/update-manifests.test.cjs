const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {validateManifests, writeManifest, verifyUpdaterSignature} = require('../scripts/update-manifests.cjs');
const {installerAssets, updaterAssets} = require('../scripts/release-assets.cjs');
const {signingFixture} = require('./helpers/updater.cjs');
function fixture(callback) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-updater-')), signing = signingFixture();
 try {
  for (const name of new Set([...installerAssets, ...updaterAssets])) fs.writeFileSync(path.join(dir, name), Buffer.from(name));
  for (const name of updaterAssets) fs.writeFileSync(path.join(dir, name + '.sig'), signing.sign(fs.readFileSync(path.join(dir, name))));
  writeManifest(dir, '0.7.0', 'Sample changes', signing.publicKey, new Date('2026-10-17T00:00:00Z'));
  callback(dir, signing);
 } finally {fs.rmSync(dir, {recursive: true, force: true});}
}
function change(dir, mutate) {const filename = path.join(dir, 'latest.json'), info = JSON.parse(fs.readFileSync(filename, 'utf8')); mutate(info); fs.writeFileSync(filename, JSON.stringify(info));}
test('one Tauri manifest maps both Mac architectures to the signed universal archive and Windows to NSIS', () => fixture((dir, signing) => {
 const before = fs.readFileSync(path.join(dir, 'latest.json'));
 const info = validateManifests(dir, '0.7.0', signing.publicKey);
 assert.deepEqual(info.platforms['darwin-aarch64'], info.platforms['darwin-x86_64']);
 assert(info.platforms['windows-x86_64'].url.endsWith('md2chat-windows-x64-setup.exe'));
 assert.deepEqual(fs.readFileSync(path.join(dir, 'latest.json')), before);
}));
test('release version, platform completeness, notes, date and pinned artifact URLs are required', () => {
 for (const mutate of [info => {info.version = '0.6.0';}, info => {delete info.platforms['darwin-aarch64'];}, info => {info.notes = '';}, info => {info.pub_date = 'invalid';}, info => {info.platforms['windows-x86_64'].url = 'https://example.com/setup.exe';}]) fixture((dir, signing) => {change(dir, mutate); assert.throws(() => validateManifests(dir, '0.7.0', signing.publicKey));});
});
test('missing files, changed payloads, forged signatures or wrong public keys prevent publication', () => {
 for (const name of ['latest.json', ...installerAssets, ...updaterAssets.map(name => name + '.sig')]) fixture((dir, signing) => {fs.unlinkSync(path.join(dir, name)); assert.throws(() => validateManifests(dir, '0.7.0', signing.publicKey));});
 for (const name of updaterAssets) fixture((dir, signing) => {fs.appendFileSync(path.join(dir, name), 'modified'); assert.throws(() => validateManifests(dir, '0.7.0', signing.publicKey), /signature/);});
 fixture((dir, signing) => {change(dir, info => {info.platforms['windows-x86_64'].signature = 'forged';}); assert.throws(() => validateManifests(dir, '0.7.0', signing.publicKey), /signature/);});
 fixture(dir => {assert.throws(() => validateManifests(dir, '0.7.0', signingFixture().publicKey), /signature/); assert.throws(() => validateManifests(dir, '0.7.0', ''), /PUBLIC_KEY/);});
});
test('manifest creation restores the previous public endpoint when verification fails', () => fixture((dir, signing) => {
 const before = fs.readFileSync(path.join(dir, 'latest.json'));
 fs.appendFileSync(path.join(dir, updaterAssets[0]), 'modified');
 assert.throws(() => writeManifest(dir, '0.7.1', 'Next release', signing.publicKey), /signature/);
 assert.deepEqual(fs.readFileSync(path.join(dir, 'latest.json')), before);
}));
test('signed trusted comments cannot be modified', () => {
 const signing = signingFixture(), data = Buffer.from('test'), signature = signing.sign(data);
 const changed = Buffer.from(Buffer.from(signature, 'base64').toString().replace('timestamp:1', 'timestamp:2')).toString('base64');
 assert.throws(() => verifyUpdaterSignature(data, changed, signing.publicKey), /verification failed/);
});
test('verification agrees with the upstream minisign-verify known signature fixture', () => {
 // https://docs.rs/minisign-verify/latest/minisign_verify/ (payload is "test").
 const key = Buffer.from('untrusted comment: public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n').toString('base64');
 const signature = Buffer.from('untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==\n').toString('base64');
 assert.doesNotThrow(() => verifyUpdaterSignature(Buffer.from('test'), signature, key));
 assert.throws(() => verifyUpdaterSignature(Buffer.from('modified'), signature, key), /verification failed/);
});
