const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {installerAssets, updaterAssets} = require('./release-assets.cjs');
const repository = 'https://github.com/forgeturl/md2chat/releases/download/';
const platformAssets = {'darwin-aarch64': updaterAssets[0], 'darwin-x86_64': updaterAssets[0], 'windows-x86_64': updaterAssets[1]};

// Tauri stores Minisign public keys and signature boxes as Base64-encoded text.
// Verify both Ed25519 signatures, including the signed trusted comment.
function verifyUpdaterSignature(data, signature, publicKey) {
 const publicLines = Buffer.from(publicKey, 'base64').toString('utf8').trim().split(/\r?\n/);
 const key = Buffer.from(publicLines[1] || '', 'base64');
 const lines = Buffer.from(signature, 'base64').toString('utf8').trim().split(/\r?\n/);
 const signed = Buffer.from(lines[1] || '', 'base64');
 const globalSignature = Buffer.from(lines[3] || '', 'base64');
 if (key.length !== 42 || key.subarray(0, 2).toString() !== 'Ed' || signed.length !== 74 || signed.subarray(0, 2).toString() !== 'ED'
  || !key.subarray(2, 10).equals(signed.subarray(2, 10)) || globalSignature.length !== 64 || !lines[2]?.startsWith('trusted comment: ')) throw new Error('Invalid Tauri updater signature or public key');
 const ed25519 = crypto.createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki'});
 const content = crypto.createHash('blake2b512').update(data).digest();
 const signedComment = Buffer.concat([signed.subarray(10), Buffer.from(lines[2].slice('trusted comment: '.length))]);
 if (!crypto.verify(null, content, ed25519, signed.subarray(10)) || !crypto.verify(null, signedComment, ed25519, globalSignature)) throw new Error('Tauri updater signature verification failed');
}
function validateManifests(directory, version, publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY) {
 if (!publicKey?.trim()) throw new Error('TAURI_UPDATER_PUBLIC_KEY is required to verify update assets');
 const info = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'));
 if (!info || info.version !== version || typeof info.notes !== 'string' || !info.notes.trim() || !info.platforms
  || Object.keys(info.platforms).sort().join(',') !== Object.keys(platformAssets).sort().join(',')) throw new Error('Invalid Tauri update manifest');
 if (typeof info.pub_date !== 'string' || !Number.isFinite(Date.parse(info.pub_date))) throw new Error('Invalid update publication date');
 if (info.releases !== undefined) require('./release-summaries.cjs').validateCatalog(info.releases, version);
 if (info.releaseNotes !== undefined) require('./update-history.cjs').validateHistory(directory, info.releaseNotes, version);
 for (const [platform, name] of Object.entries(platformAssets)) {
  const entry = info.platforms[platform];
  if (entry.url !== repository + 'v' + version + '/' + name) throw new Error('Unexpected update asset URL');
  const signature = fs.readFileSync(path.join(directory, name + '.sig'), 'utf8').trim();
  if (entry.signature !== signature) throw new Error('Update signature does not match asset');
  const data = fs.readFileSync(path.join(directory, name));
  if (!data.length) throw new Error('Empty update asset');
  verifyUpdaterSignature(data, signature, publicKey);
 }
 for (const name of installerAssets) if (!fs.statSync(path.join(directory, name)).size) throw new Error('Empty installer: ' + name);
 return info;
}
function writeManifest(directory, version, notes, publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY, now = new Date(), releases) {
 const info = {version, notes, pub_date: now.toISOString(), platforms: {}};
 const history = releases && require('./update-history.cjs').buildHistory(releases,version);
 if (history) info.releaseNotes = history.metadata;
 for (const [platform, name] of Object.entries(platformAssets)) info.platforms[platform] = {
  signature: fs.readFileSync(path.join(directory, name + '.sig'), 'utf8').trim(),
  url: repository + 'v' + version + '/' + name
 };
 const writes = new Map(history?.files || []);writes.set('latest.json',Buffer.from(JSON.stringify(info,null,2)+'\n'));
 const originals = new Map([...writes.keys()].map(name => [name,fs.existsSync(path.join(directory,name)) ? fs.readFileSync(path.join(directory,name)) : null]));
 try {
  for (const [name,data] of writes) fs.writeFileSync(path.join(directory,name),data);
  return validateManifests(directory, version, publicKey);
 } catch (error) {
  for (const [name,data] of originals) {
   if (data === null) fs.rmSync(path.join(directory,name),{force:true});
   else fs.writeFileSync(path.join(directory,name),data);
  }
  throw error;
 }
}
if (require.main === module) {
 const directory = process.argv[2] || 'release';
 const version = require('../package.json').version;
 const releaseNotes = fs.readFileSync(path.resolve(__dirname, '../docs/release-notes.md'), 'utf8');
 require('./release.cjs').validateNotes(releaseNotes, version);
 const releases = require('./release-summaries.cjs').readCatalog(path.resolve(__dirname, '..'), version, releaseNotes);
 // Older clients still get short, readable notes; newer clients use localized history.
 const current = releases[0];
 const notes = [...current.summary['zh-CN'], ...(current.important?.['zh-CN'] || [])].map(line => '- ' + line).join('\n');
 writeManifest(directory, version, notes, undefined, undefined, releases);
}
module.exports = {validateManifests, writeManifest, verifyUpdaterSignature};
