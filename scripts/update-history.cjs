const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {locales, validateCatalog} = require('./release-summaries.cjs');
const indexFile = 'update-history-v1.json';
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const descriptor = (file, bytes) => ({file, bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
function buildHistory(catalog, version) {
 validateCatalog(catalog, version);
 const groups = new Map(), files = new Map();
 for (const entry of catalog.filter(entry => !entry.unpublished)) {
  const [major,minor,patch] = entry.version.split('.').map(Number), key = `${major}.${minor}-${Math.floor(patch/50)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
 }
 const chunks = [];
 for (const [key, entries] of groups) {
  const chunk = {versions:entries.map(entry=>entry.version), files:{}};
  for (const locale of locales) {
   const releases = entries.map(entry => ({version:entry.version, summary:entry.summary[locale], ...(entry.important ? {important:entry.important[locale]} : {})}));
   const filename = `update-history-v1-${locale}-${key}.json`;
   const bytes = encode({schemaVersion:1, targetVersion:version, locale, releases});
   if (bytes.length > 256 * 1024) throw new Error('Update history chunk exceeds client limit');
   files.set(filename,bytes);chunk.files[locale] = descriptor(filename,bytes);
  }
  chunks.push(chunk);
 }
 const bytes = encode({schemaVersion:1,targetVersion:version,chunks});
 if (bytes.length > 2 * 1024 * 1024) throw new Error('Update history index exceeds client limit');
 files.set(indexFile,bytes);
 return {files, metadata:{schemaVersion:1,current:catalog[0],history:descriptor(indexFile,bytes)}};
}
function verifyFile(directory, reference) {
 if (!reference || !/^update-history-v1(?:-[\w.-]+)?\.json$/.test(reference.file || '') || !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || !/^[a-f0-9]{64}$/.test(reference.sha256 || '')) throw new Error('Invalid history file reference');
 const bytes = fs.readFileSync(path.join(directory,reference.file));
 if (JSON.stringify(descriptor(reference.file,bytes)) !== JSON.stringify({file:reference.file,bytes:reference.bytes,sha256:reference.sha256})) throw new Error('Update history integrity mismatch: ' + reference.file);
 return JSON.parse(bytes);
}
function validateHistory(directory, metadata, version) {
 if (!metadata || metadata.schemaVersion !== 1 || metadata.current?.version !== version || metadata.history?.file !== indexFile) throw new Error('Invalid release-notes protocol');
 // Rebuild from the localized files and compare the complete generated contract.
 const index = verifyFile(directory,metadata.history);
 if (index.schemaVersion !== 1 || index.targetVersion !== version || !Array.isArray(index.chunks)) throw new Error('Invalid update history index');
 const entries = new Map();
 for (const chunk of index.chunks) {
  if (!Array.isArray(chunk.versions) || !chunk.versions.length || chunk.versions.length > 50) throw new Error('Invalid update history chunk');
  for (const locale of locales) {
   const data = verifyFile(directory,chunk.files?.[locale]);
   if (data.schemaVersion !== 1 || data.targetVersion !== version || data.locale !== locale || JSON.stringify(data.releases?.map(entry=>entry.version)) !== JSON.stringify(chunk.versions)) throw new Error('History language or version mismatch');
   for (const entry of data.releases) {
    if (!entries.has(entry.version)) entries.set(entry.version,{version:entry.version,summary:{}});
    const output = entries.get(entry.version);output.summary[locale] = entry.summary;
    if (entry.important !== undefined) (output.important ||= {})[locale] = entry.important;
   }
  }
 }
 const rebuilt = buildHistory([...entries.values()],version);
 if (!isDeepStrictEqual(rebuilt.metadata, metadata)) throw new Error('Current summary or history index mismatch');
 for (const [file,bytes] of rebuilt.files) if (!fs.readFileSync(path.join(directory,file)).equals(bytes)) throw new Error('Unexpected update history data: ' + file);
 for (const name of fs.readdirSync(directory)) if (/^update-history-v1.*\.json$/.test(name) && !rebuilt.files.has(name)) throw new Error('Unexpected history asset would be published: ' + name);
 return [...rebuilt.files.keys()];
}
module.exports = {buildHistory, validateHistory};
