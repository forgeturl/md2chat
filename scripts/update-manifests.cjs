const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const {expectedAssets} = require('./release-assets.cjs');
function combineManifests(directory, version) {
 const specs = [
  ['latest-mac-arm64.yml', expectedAssets.slice(0, 2)],
  ['latest-mac-x64.yml', expectedAssets.slice(2, 4)],
  ['latest.yml', expectedAssets.slice(4)]
 ];
 const manifests = specs.map(([name, names]) => {
  const info = yaml.load(fs.readFileSync(path.join(directory, name), 'utf8'));
  if (!info || info.version !== version || !Array.isArray(info.files) || info.files.length !== names.length) throw new Error('Invalid update manifest: ' + name);
  const seen = new Set();
  for (const file of info.files) {
   if (!names.includes(file.url) || seen.has(file.url)) throw new Error('Unexpected update asset');
   seen.add(file.url);
   const data = fs.readFileSync(path.join(directory, file.url));
   if (!data.length || data.length !== file.size || crypto.createHash('sha512').update(data).digest('base64') !== file.sha512) throw new Error('Update checksum mismatch: ' + file.url);
  }
  if (!info.files.some(file => file.url === info.path && file.sha512 === info.sha512)) throw new Error('Invalid legacy update metadata');
  return info;
 });
 if (manifests.some(info => typeof info.releaseNotes !== 'string' || info.releaseNotes !== manifests[0].releaseNotes)) throw new Error('Missing or inconsistent release notes');
 // Separate matrix builds write the same filename. Merge explicitly, never last-writer-wins.
 const mac = {...manifests[1], files: [...manifests[0].files, ...manifests[1].files]};
 fs.writeFileSync(path.join(directory, 'latest-mac.yml'), yaml.dump(mac));
 return mac;
}
if (require.main === module) combineManifests(process.argv[2] || 'release', require('../package.json').version);
module.exports = {combineManifests};
