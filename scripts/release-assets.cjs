const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Stable public names keep website download links independent of the version.
const installerAssets = ['md2chat-mac-universal.dmg', 'md2chat-windows-x64-setup.exe'];
const updaterAssets = ['md2chat-mac-universal.app.tar.gz', 'md2chat-windows-x64-setup.exe'];
const expectedAssets = [installerAssets[0], updaterAssets[0], updaterAssets[0] + '.sig', installerAssets[1], installerAssets[1] + '.sig', 'latest.json'];
function writeChecksums(directory) {
 const lines = expectedAssets.map(name => {
  const data = fs.readFileSync(path.join(directory, name));
  if (!data.length) throw new Error('Empty release asset: ' + name);
  return crypto.createHash('sha256').update(data).digest('hex') + '  ' + name;
 });
 fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
}
if (require.main === module) writeChecksums(process.argv[2] || 'release');
module.exports = {expectedAssets, installerAssets, updaterAssets, writeChecksums};
