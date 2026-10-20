const fs = require('node:fs');
const path = require('node:path');
const locales = require('../assets/locales.json').locales.map(item => item.code);
const file = 'docs/update-summaries.json';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function compare(a, b) {
 const left = a.split('.').map(Number), right = b.split('.').map(Number);
 for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
 return 0;
}
function validateEntry(entry) {
 if (!entry || !versionPattern.test(entry.version) || !entry.version.split('.').map(Number).every(Number.isSafeInteger)) throw new Error('Invalid summary version.');
 if (Object.keys(entry).some(key => !['version','summary','important','unpublished'].includes(key))) throw new Error('Unknown summary field: ' + entry.version);
 if (entry.unpublished === true && entry.summary === undefined && entry.important === undefined) return entry;
 if (entry.unpublished !== undefined) throw new Error('Unpublished versions must contain only version and unpublished: true.');
 for (const field of ['summary', 'important']) {
  if (field === 'important' && entry[field] === undefined) continue;
  const translations = entry[field];
  if (!translations || Object.keys(translations).some(code => !locales.includes(code))) throw new Error('Invalid summary languages: ' + entry.version);
  let count;
  for (const code of locales) {
   const lines = translations[code];
   if (!Array.isArray(lines) || lines.length < 1 || lines.length > 3 || (count !== undefined && count !== lines.length)) throw new Error(`${entry.version}: ${field} needs 1–3 matching items in all nine languages (${code}).`);
   count = lines.length;
   for (const line of lines) {
    if (typeof line !== 'string' || !line.trim() || [...line].length > 180 || /[\r\n<>]|^(?:TODO|TBD|FIXME|待补充|待填写)/i.test(line)) throw new Error(`${entry.version}: ${code} summary must be a short, complete plain-text sentence (max 180 characters).`);
   }
  }
 }
 return entry;
}
function validateCatalog(catalog, version, notes, {allowUnpublishedHead = false} = {}) {
 if (!Array.isArray(catalog) || !catalog.length || catalog[0].version !== version || (!allowUnpublishedHead && catalog[0].unpublished)) throw new Error('The first update summary must match version ' + version + '.');
 const documented = notes && new Set([...notes.matchAll(/^#{1,6}\s+v(\d+\.\d+\.\d+)\s*$/gm)].map(match => match[1]));
 for (let i = 0; i < catalog.length; i++) {
  const entry = validateEntry(catalog[i]);
  if (i && compare(catalog[i - 1].version, entry.version) <= 0) throw new Error('Update summaries must have unique versions, newest first.');
  if (documented && !documented.has(entry.version)) throw new Error('Summary has no detailed release notes: ' + entry.version);
 }
 if (documented) for (const documentedVersion of documented) {
  if (!catalog.some(entry => entry.version === documentedVersion)) throw new Error('Missing historical update summary: ' + documentedVersion);
 }
 return catalog;
}
function readCatalog(root, version, notes) {
 return validateCatalog(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')), version, notes);
}
if (require.main === module) {
 const root = path.resolve(__dirname, '..');
 readCatalog(root, require('../package.json').version, fs.readFileSync(path.join(root, 'docs/release-notes.md'), 'utf8'));
 console.log('Update summaries: all versions and nine languages checked.');
}
module.exports = {file, locales, validateEntry, validateCatalog, readCatalog};
