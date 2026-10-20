const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/tauri-bridge.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({native = true, hint = 'MacIntel', listenerGate = Promise.resolve(), invoke} = {}) {
 const calls = [], listeners = new Map(), documentListeners = new Map(), stopped = [];
 const window = {location: {href: 'tauri://localhost/editor.html', origin: 'tauri://localhost'}};
 if (native) window.__TAURI__ = {
  core: {invoke: async (command, args) => {calls.push({command, args}); return invoke?.(command, args);}},
  event: {listen: async (name, callback) => {await listenerGate; listeners.set(name, callback); return () => {stopped.push(name); listeners.delete(name);};}}
 };
 const context = {window, navigator: {platform: hint}, document: {addEventListener(name, callback) {documentListeners.set(name, callback);}}, URL, Error, console};
 vm.runInNewContext(source, context);
 return {window, bridge: window.md2chatDesktop, preferences: window.md2chatPreferences, calls, listeners, documentListeners, stopped};
}
test('website remains independent of Tauri and desktop platform is available synchronously', () => {
 assert.equal(fixture({native: false}).bridge, undefined);
 for (const [hint, platform] of [['MacIntel', 'darwin'], ['Win32', 'win32'], ['Linux x86_64', 'linux']]) assert.equal(fixture({hint}).bridge.platform, platform);
});
test('ready waits for both conversion callbacks and the native listener registration', async () => {
 let resolveListener; const listenerGate = new Promise(resolve => {resolveListener = resolve;});
 const state = fixture({listenerGate});
 state.bridge.onConvertClipboard(() => []); await tick(); assert.equal(state.calls.length, 0);
 state.bridge.onWecomSegments(() => {}); await tick(); assert.equal(state.calls.length, 0);
 resolveListener(); await tick(); assert.equal(state.calls[0].command, 'conversion_ready');
 assert(state.listeners.has('md2chat:conversion-request'));
 await state.bridge.ready(); assert.equal(state.calls.filter(call => call.command === 'conversion_ready').length, 1);
});
test('conversion event carries only ID and kind; content is taken through the authorized native command', async () => {
 const state = fixture({invoke: async command => command === 'conversion_take' ? {content: 'private body', target: 'feishu', kind: 'render'} : undefined});
 const seen = [];
 state.bridge.onWecomSegments(() => {}); state.bridge.onConvertClipboard((content, target) => {seen.push({content, target}); return [{type: 'text', text: 'converted'}];});
 await tick(); state.listeners.get('md2chat:conversion-request')({payload: {id: 1, kind: 'render', content: 'forged event body'}}); await tick();
 assert.equal(seen[0].content, 'private body'); assert.equal(seen[0].target, 'feishu');
 const take = state.calls.find(call => call.command === 'conversion_take'); assert.equal(take.args.id, 1); assert.equal(Object.keys(take.args).length, 1);
 const result = state.calls.find(call => call.command === 'conversion_result'); assert.equal(result.args.result.parts[0].text, 'converted');
});
test('render errors and segment opening report completion without leaking unhandled rejections', async () => {
 let kind = 'render';
 const state = fixture({invoke: async command => command === 'conversion_take' ? {kind, parts: [{type: 'text', text: 'segment'}]} : undefined});
 let opened;
 state.bridge.onConvertClipboard(() => {throw new Error('图片读取失败');}); state.bridge.onWecomSegments(parts => {opened = parts;});
 await tick(); const deliver = payload => state.listeners.get('md2chat:conversion-request')({payload});
 deliver({id: 2, kind}); await tick(); assert.equal(state.calls.find(call => call.command === 'conversion_result').args.result.error, '图片读取失败');
 kind = 'segments'; deliver({id: 3, kind}); await tick(); assert.equal(opened[0].text, 'segment');
 assert.equal(state.calls.filter(call => call.command === 'conversion_result').at(-1).args.result.parts.length, 0);
});
test('native failures are normalized as Error and preferences use narrow commands', async () => {
 const state = fixture({invoke: async command => {if (command === 'desktop_copy') throw '读取失败'; return {saved: true};}});
 await assert.rejects(() => state.bridge.copy([], 'wechat'), /读取失败/);
 await state.preferences.set({openAtLogin: true}); const call = state.calls.at(-1); assert.equal(call.command, 'preferences_set'); assert.equal(call.args.patch.openAtLogin, true);
 assert(Object.isFrozen(state.bridge)); assert(Object.isFrozen(state.preferences));
});
test('disposing a subscription before asynchronous registration releases its listener', async () => {
 const state = fixture(); const dispose = state.bridge.updates.subscribe(() => {}); dispose(); await tick();
 assert(state.stopped.includes('md2chat:update-state')); assert(!state.listeners.has('md2chat:update-state'));
});
test('editor image rendering starts only on the native reserved request and returns exactly one image', async () => {
 let finish,renderCount=0;
 const nativeResult=new Promise(resolve=>{finish=resolve;}),image={type:'image',src:'data:image/png;base64,AAAA'};
 const state=fixture({invoke:async(command,args)=>{
  if(command==='desktop_copy_image')return nativeResult;
  if(command==='conversion_take')return {kind:'editor-image'};
  if(command==='conversion_result'){finish({type:'image'});assert.equal(args.result.parts[0],image);}
 }});
 state.bridge.onConvertClipboard(()=>[]);state.bridge.onWecomSegments(()=>{});await tick();
 const copy=state.bridge.copyImage(async()=>{renderCount++;return image;});await tick();
 assert(state.calls.some(call=>call.command==='desktop_copy_image'));
 assert.equal(renderCount,0);
 state.listeners.get('md2chat:conversion-request')({payload:{id:7,kind:'editor-image'}});
 await copy;assert.equal(renderCount,1);
 assert(!state.calls.some(call=>call.command==='desktop_copy_segment'));
});
test('busy rejection releases the image callback for retry without starting rendering', async () => {
 let renders=0;
 const state=fixture({invoke:async command=>{if(command==='desktop_copy_image')throw '正在转换或复制，请稍候再试。';}});
 state.bridge.onConvertClipboard(()=>[]);state.bridge.onWecomSegments(()=>{});await tick();
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(()=>state.bridge.copyImage(async()=>{renders++;}),/正在转换或复制/);
 assert.equal(renders,0);
 assert.equal(state.calls.filter(call=>call.command==='desktop_copy_image').length,2);
});
test('image render errors report completion and retries cannot reuse the old callback', async () => {
 let rejectNative;
 const state=fixture({invoke:async(command,args)=>{
  if(command==='desktop_copy_image')return new Promise((_,reject)=>{rejectNative=reject;});
  if(command==='conversion_take')return {kind:'editor-image'};
  if(command==='conversion_result')rejectNative(args.result.error);
 }});
 state.bridge.onConvertClipboard(()=>[]);state.bridge.onWecomSegments(()=>{});await tick();
 for(let attempt=1;attempt<=2;attempt++){
  const copy=state.bridge.copyImage(async()=>{throw new Error('图片读取失败');});
  const rejected=assert.rejects(()=>copy,/图片读取失败/);await tick();
  state.listeners.get('md2chat:conversion-request')({payload:{id:attempt,kind:'editor-image'}});
  await rejected;
 }
 assert.equal(state.calls.filter(call=>call.command==='desktop_copy_image').length,2);
});
test('a pending decode cannot overlap another renderer even after a native request times out', async () => {
 let finishDecode,renders=0;
 const decode=new Promise(resolve=>{finishDecode=resolve;});
 const state=fixture({invoke:async(command,args)=>command==='conversion_take'?{kind:'render',content:args.id}:undefined});
 state.bridge.onWecomSegments(()=>{});
 state.bridge.onConvertClipboard(async()=>{renders++;await decode;return [];});await tick();
 const deliver=id=>state.listeners.get('md2chat:conversion-request')({payload:{id,kind:'render'}});
 deliver(1);await tick();deliver(2);await tick();
 assert.equal(renders,1);
 assert.match(state.calls.find(call=>call.command==='conversion_result'&&call.args.id===2).args.result.error,/正在转换或复制/);
 finishDecode();await tick();deliver(3);await tick();assert.equal(renders,2);
});
test('external links invoke the restricted native opener instead of navigating the WebView', async () => {
 const state = fixture(); let prevented = false;
 state.documentListeners.get('click')({target: {closest: () => ({href: 'https://github.com/forgeturl/md2chat'})}, preventDefault() {prevented = true;}});
 await tick(); assert(prevented); assert.equal(state.calls.at(-1).command, 'desktop_open_external');
 assert.equal(state.calls.at(-1).args.url, 'https://github.com/forgeturl/md2chat');
});

test('diagnostic ZIP saving uses a dedicated command without accepting a destination path',async()=>{
 const state=fixture({invoke:async command=>command==='desktop_save_diagnostics'});
 const saved=await state.bridge.saveDiagnostics('md2chat-clipboard-test.zip','UEsDBA==');
 assert.equal(saved,true);const call=state.calls.at(-1);
 assert.equal(call.command,'desktop_save_diagnostics');assert.equal(call.args.name,'md2chat-clipboard-test.zip');assert.equal(call.args.data,'UEsDBA==');
 assert.deepEqual(Object.keys(call.args).sort(),['data','name']);
});
