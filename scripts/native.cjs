const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {nativeEnv} = require('./native-env.cjs');
const [tool, ...args] = process.argv.slice(2);
if (!['cargo', 'tauri'].includes(tool)) throw new Error('Expected cargo or tauri');
const result = spawnSync(tool === 'cargo' ? 'cargo' : process.execPath,
 tool === 'cargo' ? args : [path.resolve(__dirname, '../node_modules/@tauri-apps/cli/tauri.js'), ...args],
 {stdio:'inherit', env:nativeEnv()});
if (result.error) throw result.error;
process.exitCode = result.status === 0 ? 0 : (result.status || 1);
