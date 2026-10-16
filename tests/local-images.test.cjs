const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {localImagePath,readLocalImage}=require('../desktop/local-images.cjs');

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6L8AAAAASUVORK5CYII=','base64');
const imageStub=({width=1,height=1,empty=false,decode}={})=>({
 createFromBuffer(bytes){
  if(decode)decode(bytes);
  return {isEmpty:()=>empty,getSize:()=>({width,height})};
 }
});
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-local-images-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 return directory;
}

test('local image paths accept platform absolute paths and local file URLs',()=>{
 for(const platform of ['darwin','linux']){
  assert.equal(localImagePath('/tmp/图片 空格(a).png',{platform}),'/tmp/图片 空格(a).png');
  assert.equal(localImagePath('file:///tmp/%E5%9B%BE%E7%89%87%20%E7%A9%BA%E6%A0%BC(a).png',{platform}),'/tmp/图片 空格(a).png');
  assert.equal(localImagePath('file://localhost/tmp/local.png',{platform}),'/tmp/local.png');
  assert.equal(localImagePath('/tmp/literal%20name.png',{platform}),'/tmp/literal%20name.png');
 }
 for(const source of ['C:\\Users\\name\\图片 空格.png','C:/Users/name/图片 空格.png','file:///C:/Users/name/%E5%9B%BE%E7%89%87%20%E7%A9%BA%E6%A0%BC.png']){
  assert.equal(localImagePath(source,{platform:'win32'}),'C:\\Users\\name\\图片 空格.png');
 }
});

test('local image paths reject relative paths, remote shares and URL authority or suffixes',()=>{
 const invalid=[undefined,null,42,{},[], '', 'relative.png','./relative.png','../relative.png','https://example.com/a.png','data:image/png;base64,AAAA',
  'file://server/share/a.png','file://user@localhost/tmp/a.png','file://user:password@localhost/tmp/a.png','file:///tmp/a.png?token=secret','file:///tmp/a.png#part',
  'file:///tmp/%00a.png','file:///tmp/%0Aa.png','file:///tmp/bad%ZZ.png','/tmp/a\u0000.png','/tmp/a\n.png','/tmp/a\t.png','/tmp/'+ 'a'.repeat(8192)];
 for(const platform of ['darwin','linux','win32'])for(const source of invalid){
  assert.throws(()=>localImagePath(source,{platform}),undefined,String(source)+' on '+platform);
 }
 for(const source of ['C:relative.png','\\root-relative.png','\\\\server\\share\\a.png','//server/share/a.png','\\\\?\\C:\\a.png']){
  assert.throws(()=>localImagePath(source,{platform:'win32'}));
 }
 assert.throws(()=>localImagePath('C:/Users/name/a.png',{platform:'darwin'}));
});

test('local images read absolute paths and file URLs with spaces and Chinese names',async t=>{
 const directory=await fixture(t),file=path.join(directory,'图片 空格(a).png');
 await fs.writeFile(file,png);
 const decoded=[];
 for(const source of [file,pathToFileURL(file).href]){
  const result=await readLocalImage(source,{nativeImage:imageStub({decode:bytes=>decoded.push(Buffer.from(bytes))})});
  assert.equal(result,'data:image/png;base64,'+png.toString('base64'));
 }
 assert.equal(decoded.length,2);
 assert(decoded.every(bytes=>bytes.equals(png)));
});

test('local image MIME comes from raster signatures and preserves original bytes',async t=>{
 const directory=await fixture(t);
 const examples=[
  ['png',png],
  ['jpeg',Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0,1,0xff,0xd9])],
  ['gif',Buffer.concat([Buffer.from('GIF89a'),Buffer.alloc(20)])],
  ['webp',Buffer.concat([Buffer.from('RIFF'),Buffer.from([16,0,0,0]),Buffer.from('WEBPVP8 '),Buffer.alloc(12)])],
  ['bmp',Buffer.concat([Buffer.from('BM'),Buffer.alloc(52)])]
 ];
 for(const [mime,bytes] of examples){
  const file=path.join(directory,mime+'.txt');await fs.writeFile(file,bytes);
  const result=await readLocalImage(file,{nativeImage:imageStub({decode:decoded=>assert.deepEqual(decoded,bytes)})});
  assert.equal(result,'data:image/'+mime+';base64,'+bytes.toString('base64'));
 }
});

test('missing files, directories and files only disguised as images fail before decoding',async t=>{
 const directory=await fixture(t),disguised=path.join(directory,'secret.png');
 await fs.writeFile(disguised,'plain text that is not an image');
 const nativeImage=imageStub({decode:()=>assert.fail('invalid files must not be decoded')});
 await assert.rejects(()=>readLocalImage(path.join(directory,'missing.png'),{nativeImage}),{message:'文件不存在。'});
 await assert.rejects(()=>readLocalImage(directory,{nativeImage}));
 await assert.rejects(()=>readLocalImage(disguised,{nativeImage}),{message:'不支持的图片格式。'});
 const svg=path.join(directory,'vector.png');await fs.writeFile(svg,'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
 await assert.rejects(()=>readLocalImage(svg,{nativeImage}));
});

test('local images reject files above 10 MiB before decoding',async t=>{
 const directory=await fixture(t),file=path.join(directory,'oversized.png');
 await fs.writeFile(file,png);await fs.truncate(file,10*1024*1024+1);
 await assert.rejects(()=>readLocalImage(file,{nativeImage:imageStub({decode:()=>assert.fail('oversized bytes must not be decoded')})}));
});

test('local images allow the file-size boundary and 20 million pixels',async t=>{
 const directory=await fixture(t),file=path.join(directory,'boundary.png');
 await fs.writeFile(file,png);await fs.truncate(file,10*1024*1024);
 const result=await readLocalImage(file,{nativeImage:imageStub({width:5000,height:4000})});
 assert.equal(result.slice(0,22),'data:image/png;base64,');
 assert.equal(Buffer.from(result.slice(result.indexOf(',')+1),'base64').length,10*1024*1024);
});

test('local images require native decoding and positive dimensions within the pixel budget',async t=>{
 const directory=await fixture(t),file=path.join(directory,'pixel-limits.png');await fs.writeFile(file,png);
 for(const options of [{empty:true},{width:0},{height:0},{width:-1},{height:-1},{width:NaN},{height:Infinity},{width:5001,height:4000}]){
  await assert.rejects(()=>readLocalImage(file,{nativeImage:imageStub(options)}));
 }
 await assert.rejects(()=>readLocalImage(file,{nativeImage:{createFromBuffer(){throw new Error('decoder failure');}}}));
});

test('local images refuse a final symbolic link before opening it',async t=>{
 const directory=await fixture(t),target=path.join(directory,'original.png'),link=path.join(directory,'linked.png');await fs.writeFile(target,png);
 try{await fs.symlink(target,link);}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('symbolic links unavailable');return;}throw error;}
 const open=t.mock.method(fs,'open',()=>assert.fail('symbolic links must not be opened'));
 await assert.rejects(()=>readLocalImage(link,{nativeImage:imageStub()}));
 assert.equal(open.mock.calls.length,0);
});

test('local image reads compare opened file identity and always close the handle',async t=>{
 const directory=await fixture(t),file=path.join(directory,'changed.png');await fs.writeFile(file,png);
 const originalOpen=fs.open.bind(fs);let closed=0;
 t.mock.method(fs,'open',async(...args)=>{
  const handle=await originalOpen(...args);
  return {stat:async()=>{const stat=await handle.stat();return Object.assign(Object.create(stat),{ino:stat.ino+1});},read:()=>assert.fail('changed files must not be read'),close:async()=>{closed++;await handle.close();}};
 });
 await assert.rejects(()=>readLocalImage(file,{nativeImage:imageStub({decode:()=>assert.fail('changed files must not be decoded')})}),/更新/);
 assert.equal(closed,1);
});

test('local image reads stay bounded if the file grows after its initial stat',async t=>{
 const directory=await fixture(t),file=path.join(directory,'growing.png');await fs.writeFile(file,png);
 const originalOpen=fs.open.bind(fs);let closed=0,readBytes=0,grew=false;
 t.mock.method(fs,'open',async(...args)=>{
  const handle=await originalOpen(...args);
  return {stat:async()=>{const stat=await handle.stat();if(!grew){grew=true;await fs.appendFile(file,Buffer.alloc(1024*1024));}return stat;},
   read:async(...readArgs)=>{const result=await handle.read(...readArgs);readBytes+=result.bytesRead;assert(readBytes<=png.length+1,'must stop after the initial checked size plus one byte');return result;},
   close:async()=>{closed++;await handle.close();}};
 });
 await assert.rejects(()=>readLocalImage(file,{nativeImage:imageStub({decode:()=>assert.fail('changed files must not be decoded')})}));
 assert.equal(closed,1);assert(readBytes<=png.length+1);
});

test('desktop local image IPC rejects foreign callers and remains available during conversion',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8'),calls=[];let handler;
 const nativeImage={},context={nativeImage,copying:true,clipboardConversion:{busy:true},
  trusted:event=>{if(event!=='trusted')throw new Error('untrusted');},
  readLocalImage:async(value,options)=>{calls.push({value,options});return 'data:image/png;base64,AAAA';},
  ipcMain:{handle:(name,callback)=>{assert.equal(name,'md2chat:read-local-image');handler=callback;}}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf("ipcMain.handle('md2chat:read-local-image'"),source.indexOf("ipcMain.handle('md2chat:resolve-clipboard-html'")),context);
 await assert.rejects(()=>handler('foreign','/private/secret.png'),/untrusted/);assert.equal(calls.length,0);
 assert.equal(await handler('trusted','/tmp/local.png'),'data:image/png;base64,AAAA');
 assert.equal(calls[0].value,'/tmp/local.png');assert.equal(calls[0].options.nativeImage,nativeImage);
});

test('desktop preload forwards local image requests through its dedicated IPC',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),calls=[];let api;
 const context={process:{platform:'darwin'},require:name=>{
  assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'md2chatDesktop');api=value;}},
   ipcRenderer:{invoke:async(...args)=>{calls.push(args);return 'embedded image';}}};
 }};
 vm.createContext(context);vm.runInContext(source,context);
 assert.equal(await api.readLocalImage('/tmp/图片.png'),'embedded image');
 assert.deepEqual(calls,[['md2chat:read-local-image','/tmp/图片.png']]);
});

test('desktop local image errors omit the Electron transport prefix',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../desktop/preload.cjs'),'utf8');let api;
 const context={process:{platform:'darwin'},require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},
  ipcRenderer:{invoke:async()=>{throw new Error("Error invoking remote method 'md2chat:read-local-image': Error: 不支持的图片格式。");}}})};
 vm.createContext(context);vm.runInContext(source,context);
 await assert.rejects(()=>api.readLocalImage('/tmp/记录.json'),{message:'不支持的图片格式。'});
});
