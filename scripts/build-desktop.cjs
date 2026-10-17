const fs = require('node:fs');
const path = require('node:path');

function buildDesktop(root = path.resolve(__dirname, '..'), output = path.join(root, 'dist-desktop')) {
 fs.rmSync(output, {recursive: true, force: true});
 fs.mkdirSync(output, {recursive: true});
 for (const name of ['assets', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  fs.cpSync(path.join(root, name), path.join(output, name), {recursive: true});
 }
 // Tauri IPC on Windows uses this local protocol; no web server is bundled.
 const allowIpc = html => html.replace(/connect-src ([^;"']*(?:'[^']*'[^;"']*)*)/g, value => {
  const policy = value.replace(/\s+'none'/g, '');
  return policy.includes('ipc:') ? policy : policy + ' ipc: http://ipc.localhost';
 });
 fs.writeFileSync(path.join(output, 'editor.html'), allowIpc(fs.readFileSync(path.join(root, 'editor.html'), 'utf8')));
 for (const page of ['preferences', 'tray-panel']) {
  const html = fs.readFileSync(path.join(root, 'desktop', page + '.html'), 'utf8')
   .replaceAll('../assets/', './assets/');
  fs.writeFileSync(path.join(output, page + '.html'), allowIpc(html));
 }
 return output;
}
if (require.main === module) console.log('Desktop frontend built in ' + buildDesktop());
module.exports = {buildDesktop};
