const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {nativeEnv} = require('./native-env.cjs');
const root = path.resolve(__dirname, '..');
const qa = path.join(root, 'release/qa');
let binary = process.argv[2];
if (!binary) {
 require('./build-desktop.cjs').buildDesktop();
 const result = spawnSync(process.execPath, [path.join(__dirname, 'native.cjs'), 'cargo', 'build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml'], {cwd:root, stdio:'inherit'});
 if (result.error) throw result.error;
 if (result.status !== 0) process.exit(result.status || 1);
 binary = path.join(path.resolve(root, process.env.CARGO_TARGET_DIR || 'src-tauri/target'), process.env.CARGO_BUILD_TARGET || '', 'debug', process.platform === 'win32' ? 'md2chat.exe' : 'md2chat');
}
fs.mkdirSync(qa, {recursive:true});
const report = path.join(fs.mkdtempSync(path.join(qa, 'tauri-render-')), 'report.json');
const log = fs.openSync(path.join(path.dirname(report), 'tauri-render.log'), 'w');
const child = spawn(path.resolve(binary), ['--smoke'], {cwd:root, env:{...nativeEnv(), MD2CHAT_SMOKE_REPORT:report}, stdio:['ignore', log, log]});
const timer = setTimeout(() => {child.kill('SIGTERM'); console.error('WebView 渲染验证超时。');}, 120000);
child.on('error', error => {clearTimeout(timer);fs.closeSync(log);console.error(error.message);process.exitCode=1;});
child.on('exit', code => {
 clearTimeout(timer);fs.closeSync(log);
 if (!fs.existsSync(report)) {console.error('没有生成渲染报告，请先关闭正在运行的 md2chat 再重试。');process.exitCode=1;return;}
 const result = JSON.parse(fs.readFileSync(report, 'utf8'));
 console.log('Render report: '+report);
 console.log(JSON.stringify(result, null, 2));
 process.exitCode = code === 0 && result.status === 'passed' ? 0 : 1;
});
