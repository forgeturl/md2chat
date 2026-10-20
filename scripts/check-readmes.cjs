const fs = require('node:fs'), path = require('node:path');
const {createHash} = require('node:crypto');
const locales = require('../assets/locales.json').locales;
const sourceHash = root => createHash('sha256').update(fs.readFileSync(path.join(root, 'README.md'), 'utf8').replaceAll('\r\n', '\n')).digest('hex');
const marker = /<!-- language: ([\w-]+); source-sha256: ([a-f0-9]{64}) -->/;
function checkReadmes(root = path.resolve(__dirname, '..')) {
 const digest = sourceHash(root), main = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
 for (const {code} of locales.filter(item => item.code !== 'zh-CN')) {
  const name = 'docs/readme/' + code + '.md', file = path.join(root, name);
  if (!main.includes('](' + name + ')')) throw new Error('Missing root README language link: ' + code);
  const content = fs.readFileSync(file, 'utf8'), match = content.match(marker);
  if (match?.[1] !== code || match[2] !== digest) throw new Error('README translation needs review: ' + code + '. Update the translation, then run node scripts/check-readmes.cjs --stamp ' + code);
  if (content.length < 1500 || (content.match(/^## /gm) || []).length < 7) throw new Error('README translation must contain product, usage, privacy and development guidance: ' + code);
  for (const {code: other} of locales) {
   const target = other === 'zh-CN' ? '../../README.md' : other + '.md';
   if (!content.includes('](' + target + ')')) throw new Error('Missing README language switch: ' + code + ' → ' + other);
  }
  for (const [, target] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
   if (/^https?:\/\//.test(target)) continue;
   const linked = target.split('#')[0];
   if (linked && !fs.existsSync(path.resolve(path.dirname(file), linked))) throw new Error('Broken README link: ' + name + ' → ' + target);
  }
 }
}
function stamp(root, code) {
 if (!locales.some(item => item.code === code && code !== 'zh-CN')) throw new Error('Choose one translated README language to stamp after review.');
 const file = path.join(root, 'docs/readme', code + '.md'), content = fs.readFileSync(file, 'utf8');
 if (content.match(marker)?.[1] !== code) throw new Error('Missing README language marker: ' + code);
 fs.writeFileSync(file, content.replace(marker, `<!-- language: ${code}; source-sha256: ${sourceHash(root)} -->`));
}
if (require.main === module) {
 const root = path.resolve(__dirname, '..');
 if (process.argv[2] === '--stamp' && process.argv.length === 4) stamp(root, process.argv[3]);
 else if (process.argv.length > 2) throw new Error('Usage: node scripts/check-readmes.cjs [--stamp LANGUAGE]');
 else {checkReadmes(root);console.log('All nine README editions and translation review markers are current.');}
}
module.exports = {checkReadmes, stamp};
