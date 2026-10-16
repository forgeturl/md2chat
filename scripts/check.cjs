const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const directory of ['assets', 'scripts']) {
 for (const name of fs.readdirSync(path.join(root, directory))) {
  if (!/\.(?:cjs|js)$/.test(name)) continue;
  const result = spawnSync(process.execPath, ['--check', path.join(root, directory, name)], {stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
 }
}
