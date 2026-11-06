const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../assets/image-directory.js');
const api=fs.existsSync(file)?require(file):{};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(load){
 let actions,model,closed=0;
 const waiting=[];
 const view={open(value){actions=value;},update(value){model=value;},close(){closed++;}};
 const controller=api.create?.({load,view});
 return {controller,waiting,get actions(){return actions;},get model(){return model;},get closed(){return closed;},request(resources){return controller.request(resources,{waiting:async value=>waiting.push(value)});}};
}
test('only document-relative image paths ask for a directory',()=>{
 assert.equal(typeof api.isRelative,'function','relative-image support is missing');
 for(const src of ['assets/a.svg','./images/a.png','../图片/a%20b.png','images\\a.png'])assert.equal(api.isRelative(src),true,src);
 for(const src of ['','/tmp/a.svg','C:\\Pics\\a.svg','C:a.svg','file:///tmp/a.svg','https://host/a.svg','data:image/png;base64,AAAA','blob:x','//host/a.svg','\\\\host\\a.svg','javascript:x','a\n.svg'])assert.equal(api.isRelative(src),false,src);
});
test('confirm keeps successful reads and permits retry with a different directory',async()=>{
 assert.equal(typeof api.create,'function','directory dialog is missing');
 const reads=[],png={src:'data:image/png;base64,AAAA',width:10,height:10};
 const f=fixture(async(resource,directory)=>{assert.equal(f.waiting.at(-1),false,'file checks must run under the render deadline');reads.push([resource,directory]);if(directory==='/bad'&&resource==='b.svg')throw Object.assign(new Error('missing'),{resolvedPath:'/bad/b.svg'});return png;});
 const result=f.request(['a.svg','b.svg']);await tick();
 await f.actions.submit('/bad');assert.equal(f.model.loaded,1);assert.equal(f.model.missing,1);assert.equal(f.model.failures[0].resolvedPath,'/bad/b.svg');assert.equal(f.closed,0);
 await f.actions.submit('/good');const value=await result;
 assert.equal(value.get('a.svg'),png);assert.equal(value.get('b.svg'),png);assert.deepEqual(reads,[['a.svg','/bad'],['b.svg','/bad'],['a.svg','/good'],['b.svg','/good']]);
 assert.deepEqual(f.waiting,[true,false,true,false]);assert.equal(f.closed,1);
});
test('ignore without a directory skips unresolved images without attempting reads',async()=>{
 assert.equal(typeof api.create,'function','directory dialog is missing');
 const f=fixture(()=>assert.fail('blank directory must not read files'));
 const result=f.request(['a.svg','b.svg']);await tick();await f.actions.ignore('');
 const value=await result;assert.equal(value.size,2);assert.equal(value.get('a.svg'),null);assert.equal(value.get('b.svg'),null);
});
test('ignore retains images readable from the current input and skips only failed images',async()=>{
 assert.equal(typeof api.create,'function','directory dialog is missing');
 const png={src:'data:image/png;base64,AAAA'};
 const f=fixture(async(resource,directory)=>{if(directory!=='/current'||resource==='missing.svg')throw new Error('missing');return png;});
 const result=f.request(['a.svg','missing.svg']);await tick();await f.actions.submit('/wrong');
 await f.actions.ignore('/current');const value=await result;assert.equal(value.get('a.svg'),png);assert.equal(value.get('missing.svg'),null);
});
test('cancel settles immediately during a read and discards late results',async()=>{
 assert.equal(typeof api.create,'function','directory dialog is missing');
 let release;const gate=new Promise(resolve=>release=resolve),reads=[];
 const f=fixture(async resource=>{reads.push(resource);await gate;return {src:'PNG'};});
 const result=f.request(['a.svg','b.svg']);const rejected=assert.rejects(result,error=>error.cancelled===true);await tick();
 const checking=f.actions.submit('/docs');await tick();f.actions.cancel();await rejected;
 release();await checking;assert.deepEqual(reads,['a.svg']);assert.equal(f.closed,1);assert.deepEqual(f.waiting,[true,false]);
});
test('every new request starts empty and cancellation cannot leak into a later request',async()=>{
 assert.equal(typeof api.create,'function','directory dialog is missing');
 const f=fixture(async()=>({src:'PNG'}));
 const first=f.request(['a.svg']);const rejected=assert.rejects(first,error=>error.cancelled===true);await tick();const oldActions=f.actions;oldActions.cancel();await rejected;
 const second=f.request(['b.svg']);await tick();oldActions.cancel();assert.equal(f.model.loaded,0);assert.equal(f.model.missing,1);await f.actions.ignore('');assert.equal((await second).get('b.svg'),null);
});
