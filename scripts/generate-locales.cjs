const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/locales.json'), 'utf8'));
const output = '// Generated from locales.json by scripts/generate-locales.cjs.\n' +
 '(function(root){const data=' + JSON.stringify(data) + ';if(typeof module===\'object\')module.exports=data;else root.md2chatLocales=data;})(globalThis);\n';
const file = path.join(root, 'assets/i18n-data.js');
if (process.argv.includes('--check')) {
 if (fs.readFileSync(file, 'utf8') !== output) throw new Error('Run node scripts/generate-locales.cjs');
} else fs.writeFileSync(file, output);
