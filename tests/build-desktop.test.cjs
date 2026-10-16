const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {buildDesktop} = require('../scripts/build-desktop.cjs');
const root = path.resolve(__dirname, '..');
test('desktop staging includes only local frontend resources and resolves preferences paths', () => {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-frontend-')), out = path.join(temporary, 'frontend');
 try {
  buildDesktop(root, out);
  const editor = fs.readFileSync(path.join(out, 'editor.html'), 'utf8'), preferences = fs.readFileSync(path.join(out, 'preferences.html'), 'utf8');
  assert(editor.indexOf('tauri-bridge.js') < editor.indexOf('assets/app.js'));
  assert(preferences.indexOf('tauri-bridge.js') < preferences.indexOf('assets/preferences.js'));
  assert(!preferences.includes('../assets/')); assert.match(preferences, /connect-src ipc: http:\/\/ipc.localhost/);
  for (const html of [editor, preferences]) for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)/g)) assert(fs.existsSync(path.join(out, match[1])), match[1]);
  for (const name of ['desktop', 'node_modules', 'package.json', '.git', 'src-tauri']) assert(!fs.existsSync(path.join(out, name)), name);
  fs.writeFileSync(path.join(out, 'obsolete'), 'stale'); buildDesktop(root, out); assert(!fs.existsSync(path.join(out, 'obsolete')));
 } finally {fs.rmSync(temporary, {recursive: true, force: true});}
});
