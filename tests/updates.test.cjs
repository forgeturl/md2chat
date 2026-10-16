const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createUpdates, releaseNotes} = require('../desktop/updates.cjs');
function setup(options = {}) {
 const updater = new EventEmitter();let checks = 0, downloads = 0, installs = 0;
 updater.checkForUpdates = async () => {checks++;updater.emit('checking-for-update');updater.emit('update-available', {version:'0.7.0', releaseNotes:'- 修复复制问题'});};
 updater.downloadUpdate = async () => {downloads++;updater.emit('download-progress', {percent: 42});updater.emit('update-downloaded');};
 updater.quitAndInstall = () => {installs++;};
 const states = [];
 const controller = createUpdates({updater, version:'0.6.0', publish:s=>states.push(s), ...options});
 return {updater, controller, states, counts:()=>({checks, downloads, installs})};
}
test('new releases only download on click and install after confirmation', async () => {
 const {updater,controller,states,counts} = setup({confirmInstall:async()=>true});
 assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);
 assert.equal(updater.allowDowngrade,false);assert.equal(updater.allowPrerelease,false);
 await controller.check();assert.deepEqual(counts(),{checks:1,downloads:0,installs:0});
 assert.equal(controller.snapshot().notes,'- 修复复制问题');
 await controller.install();assert.equal(counts().installs,0);
 await controller.download();assert.equal(controller.snapshot().phase,'downloaded');
 assert(states.some(s=>s.progress===42));assert.equal(counts().installs,0);
 await controller.check();assert.equal(counts().checks,1);
 await controller.install();await controller.install();assert.equal(counts().installs,1);
});
test('canceling restart preserves downloaded update for a later explicit install', async () => {
 let consent = false;
 const {controller,counts} = setup({confirmInstall:async()=>consent});
 await controller.check();await controller.download();await controller.install();
 assert.equal(counts().installs,0);assert.equal(controller.snapshot().phase,'downloaded');
 consent=true;await controller.install();assert.equal(counts().installs,1);
});
test('concurrent checks are coalesced; installation confirmation is not duplicated', async () => {
 let finish, prompts=0;
 const {controller,counts} = setup({confirmInstall:()=>{prompts++;return new Promise(resolve=>finish=resolve);}});
 await Promise.all([controller.check(),controller.check()]);assert.equal(counts().checks,1);
 await controller.download();const first=controller.install();await controller.install();
 assert.equal(prompts,1);finish(true);await first;assert.equal(counts().installs,1);
});
test('network or integrity failures cannot install and can be retried', async () => {
 const {controller,updater,counts}=setup({confirmInstall:async()=>true});
 await controller.check();const original=updater.downloadUpdate;
 updater.downloadUpdate=async()=>{throw new Error('checksum mismatch');};
 await controller.download();assert.equal(controller.snapshot().phase,'error');
 await controller.install();assert.equal(counts().installs,0);
 updater.downloadUpdate=original;await controller.check();await controller.download();
 updater.emit('error',new Error('native signature rejected'));
 await controller.install();assert.equal(counts().installs,0);
 await controller.check();await controller.download();await controller.install();assert.equal(counts().installs,1);
});
test('unsupported or development installations never contact the updater', async () => {
 const {controller,counts}=setup({available:()=> '请先安装'});
 await controller.check();await controller.download();await controller.install();
 assert.equal(controller.snapshot().phase,'unavailable');assert.deepEqual(counts(),{checks:0,downloads:0,installs:0});
});
test('latest-version result removes stale release notes and download action', async () => {
 const {controller,updater}=setup();await controller.check();
 updater.checkForUpdates=async()=>updater.emit('update-not-available');
 await controller.check();assert.equal(controller.snapshot().phase,'current');assert.equal(controller.snapshot().notes,'');
});
test('release notes are bounded text and timer lifecycle does not create repeated schedules', () => {
 assert.equal(releaseNotes([{version:'1.0.0',note:'<b>Fix</b>'}]),'1.0.0\nFix');
 assert.equal(releaseNotes('x'.repeat(30000)).length,20000);
 let timeouts=0,intervals=0,cleared=0;
 const {controller,updater}=setup({timers:{setTimeout(){timeouts++;return 1;},setInterval(){intervals++;return 2;},clearTimeout(){cleared++;},clearInterval(){cleared++;}}});
 controller.start();controller.start();assert.equal(timeouts,1);assert.equal(intervals,1);
 controller.destroy();assert.equal(cleared,2);assert.equal(updater.listenerCount('update-available'),0);
});
