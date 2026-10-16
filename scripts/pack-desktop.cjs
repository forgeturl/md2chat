const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {nativeEnv} = require('./native-env.cjs');
const result = spawnSync(process.execPath, [path.resolve(__dirname, '../node_modules/@tauri-apps/cli/tauri.js'), 'build', '--no-bundle', '--config', JSON.stringify({bundle:{createUpdaterArtifacts:false}})], {stdio:'inherit', env:nativeEnv()});
if (result.error) throw result.error;
process.exitCode = result.status === 0 ? 0 : (result.status || 1);
