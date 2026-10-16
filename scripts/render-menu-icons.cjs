// Run with Electron to rasterize the local vector sources, without network or clipboard access.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.join(__dirname, '..');
const names = ['window', 'clipboard', 'image', 'preferences', 'help', 'update', 'quit', 'startup', 'feedback', 'info', 'wechat', 'dingtalk', 'feishu', 'wecom', 'email', 'tray'];
app.whenReady().then(async () => {
 let win;
 try {
  win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}});
  await win.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; img-src data:; script-src %27none%27">');
  for (const name of names) {
   const folder = ['wechat', 'dingtalk', 'feishu', 'wecom', 'email'].includes(name) ? 'platforms' : 'menu-icons';
   const svg = await fs.readFile(path.join(root, 'assets', folder, name + '.svg'), 'utf8');
   const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
   for (const scale of [1, 2]) {
    const size = name === 'tray' ? 22 : 16;
    const data = await win.webContents.executeJavaScript(`(async () => {
     const image = new Image();image.src = ${JSON.stringify(src)};await image.decode();
     const canvas = document.createElement('canvas');canvas.width = canvas.height = ${size * scale};
     canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
     return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    await fs.writeFile(path.join(root, 'assets/menu-icons', name + (scale === 2 ? '@2x' : '') + '.png'), Buffer.from(data, 'base64'));
   }
  }
  console.log('Rendered 15 color menu icons and the dedicated 22px tray icon, with @2x versions.');
 } catch (error) {console.error(error);process.exitCode = 1;}
 finally {if (win) win.destroy();app.exit(process.exitCode || 0);}
});
