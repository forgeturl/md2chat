const {locales} = require('../../scripts/release-summaries.cjs');
const {buildHistory} = require('../../scripts/update-history.cjs');
function catalog() {
 return ['0.7.0','0.6.50','0.6.49'].map(version => ({version,summary:Object.fromEntries(locales.map(locale=>[locale,[locale + ' update ' + version]])),
  ...(version === '0.6.50' ? {important:Object.fromEntries(locales.map(locale=>[locale,['Save your settings.']]))} : {})}));
}
function fixture() {
 const history = buildHistory(catalog(),'0.7.0');
 return {metadata:history.metadata,payloads:Object.fromEntries([...history.files].map(([name,bytes])=>[name,bytes.toString()]))};
}
module.exports = {catalog,fixture};
