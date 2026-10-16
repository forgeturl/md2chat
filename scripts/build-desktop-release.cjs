const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [platform, arch, ...extra] = process.argv.slice(2);
if (extra.length || !((platform === 'mac' && arch === 'universal') || (platform === 'win' && arch === 'x64'))) throw new Error('Invalid build target: use mac universal or win x64');
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
 const appPath = 'release/mac-universal/md2chat.app';
 const frameworks = path.join(appPath, 'Contents', 'Frameworks');
 const helpers = fs.readdirSync(frameworks).filter(name => name.endsWith('.app'));
 if (!helpers.length) throw new Error('Missing Electron helper applications');
 const binaries = [
  path.join(appPath, 'Contents', 'MacOS', 'md2chat'),
  path.join(frameworks, 'Electron Framework.framework', 'Electron Framework'),
  ...helpers.map(name => path.join(frameworks, name, 'Contents', 'MacOS', name.slice(0, -4)))
 ];
 for (const binary of binaries) run('lipo', [binary, '-verify_arch', 'arm64', 'x86_64']);
 run('codesign', ['--verify','--deep','--strict',appPath]);
 run('spctl', ['--assess','--type','execute','--verbose',appPath]);
 run('xcrun', ['stapler','validate',appPath]);
}
