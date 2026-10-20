const {test} = require('node:test'), assert = require('node:assert/strict');
const {validateCatalog, validateEntry, locales} = require('../scripts/release-summaries.cjs');
const entry = version => ({version, summary: Object.fromEntries(locales.map(code => [code,['A short update.']]))});
test('summary catalog requires matching translations, concise text, version order and complete history', () => {
 for (const mutate of [
  e => {delete e.summary.ja;}, e => {e.summary.en = [];}, e => {e.summary.en.push('Extra unmatched item.');},
  e => {e.summary.en[0] = 'x'.repeat(181);}, e => {e.summary.en[0] = 'TODO';}, e => {e.summary.en[0] = '<b>markup</b>';},
  e => {e.important = {en:['Missing translations.']};}, e => {e.version = '0.06.2';}
 ]) {const value = entry('0.6.2');mutate(value);assert.throws(() => validateEntry(value));}
 assert.throws(() => validateCatalog([entry('0.6.2'),entry('0.6.2')], '0.6.2'));
 assert.throws(() => validateCatalog([entry('0.6.2')], '0.6.3'));
 assert.throws(() => validateCatalog([entry('0.6.2')], '0.6.2', '# v0.6.2\n\n# v0.6.1\n'), /Missing historical/);
 const catalog = [entry('0.6.11'),{version:'0.6.10',unpublished:true},entry('0.6.9')];
 assert.equal(validateCatalog(catalog,'0.6.11','# v0.6.11\n# v0.6.10\n# v0.6.9\n'),catalog);
 assert.throws(() => validateCatalog([{version:'0.6.10',unpublished:true}], '0.6.10'));
});
