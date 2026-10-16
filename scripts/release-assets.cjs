const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// These names are the public README download contract. Do not embed the version.
const expectedAssets = ['md2chat-mac-arm64.dmg', 'md2chat-mac-arm64.zip', 'md2chat-mac-x64.dmg', 'md2chat-mac-x64.zip', 'md2chat-windows-x64-setup.exe'];
function writeChecksums(directory) {
 const lines = expectedAssets.map(name => {
  const data = fs.readFileSync(path.join(directory, name));
  if (!data.length) throw new Error('Empty release asset: ' + name);
  return crypto.createHash('sha256').update(data).digest('hex') + '  ' + name;
 });
 fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
}
if (require.main === module) writeChecksums(process.argv[2] || 'release');
module.exports = { expectedAssets, writeChecksums };
