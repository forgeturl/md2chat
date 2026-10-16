const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const [platform, arch] = process.argv.slice(2);
if (!['mac', 'win'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Invalid build target');
function run(command, args) {
 const result = spawnSync(command, args, {stdio: 'inherit'});
 if (result.error) throw result.error;
 if (result.status !== 0) process.exit(result.status || 1);
}
if (platform === 'mac') {
 const required = ['CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'];
 const missing = required.filter(name => !process.env[name]);
 if (missing.length) throw new Error('Configure GitHub Actions Secrets: ' + missing.join(', '));
}
run(process.execPath, ['node_modules/electron-builder/cli.js', '--' + platform, ...(platform === 'mac' ? ['dmg','zip'] : ['nsis']), '--' + arch, '--publish', 'never', ...(platform === 'mac' ? ['-c.forceCodeSigning=true'] : [])]);
if (platform === 'mac') {
 const appPath = `release/${arch === 'arm64' ? 'mac-arm64' : 'mac'}/md2chat.app`;
 run('codesign', ['--verify','--deep','--strict',appPath]);
 run('spctl', ['--assess','--type','execute','--verbose',appPath]);
 run('xcrun', ['stapler','validate',appPath]);
 fs.renameSync('release/latest-mac.yml', `release/latest-mac-${arch}.yml`);
}
