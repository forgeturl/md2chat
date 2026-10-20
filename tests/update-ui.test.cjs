const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const i18n=require('../assets/i18n.js');
const source=fs.readFileSync(require.resolve('../assets/updates.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
 constructor(){this.children=[];this.events={};this.dataset={};this.attributes={};this.textContent='';this.hidden=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,fn){this.events[name]=fn;}
 click(){if(!this.disabled)this.events.click?.();}
 showModal(){this.open=true;}
 close(){this.open=false;}
}
function fixture({initial,status,check,download,install}={}){
 const nodes=new Map(),created=[],utility=new Element(),calls=[];let locale='en',listener,onOpen;
 const find=key=>{if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
 const panel=new Element();panel.querySelector=find;panel.querySelectorAll=()=>[find('.update-close'),find('.update-dismiss')];
 const api={status:async()=>status?await status():initial||{phase:'idle',currentVersion:'0.6.19'},
  check:async()=>{calls.push('check');return check?await check():{phase:'current',currentVersion:'0.6.19'};},
  download:async()=>{calls.push('download');return download?await download():{phase:'downloaded',currentVersion:'0.6.19',version:'0.6.20'};},
  install:async()=>{calls.push('install');return install?await install():{phase:'installing',currentVersion:'0.6.19',version:'0.6.20'};},
  subscribe:fn=>listener=fn,onOpen:fn=>onOpen=fn};
 const window={md2chatDesktop:{updates:api},md2chatI18n:{t:s=>i18n.translate(s,locale),has:i18n.has,get locale(){return locale;}},events:{},addEventListener(name,fn){this.events[name]=fn;}};
 const document={body:new Element(),getElementById:()=>utility,createElement:tag=>{const e=tag==='dialog'?panel:new Element();e.tagName=tag;created.push(e);return e;}};
 vm.runInNewContext(source,{window,document});
 return {find,panel,entry:created[0],calls,emit:state=>listener(state),open:()=>onOpen(),language:code=>{locale=code;window.events['md2chat:language']();}};
}
const walk=node=>[node,...node.children.flatMap(walk)];
const summary=(version,lines=['Clearer text','<img src=x onerror=alert(1)>'])=>({version,summary:Object.fromEntries(i18n.locales.map(({code})=>[code,lines]))});
const available={releases:[summary('0.6.20')],phase:'available',currentVersion:'0.6.19',version:'0.6.20',notes:'# v0.6.20\n\n- Clearer text\n- <img src=x onerror=alert(1)>\n\n# v0.6.19\n\n- Old changes'};
test('a delayed startup snapshot cannot overwrite a newer download event',async()=>{
 let release;const initial=new Promise(resolve=>release=resolve);
 const f=fixture({status:()=>initial});
 f.emit({...available,phase:'downloaded'});
 release({phase:'idle',currentVersion:'0.6.19'});await tick();
 assert.equal(f.panel.dataset.phase,'downloaded');
 assert.equal(f.find('.update-action').textContent,'Restart and install');
});
test('updater renders the upgrade summary as literal text and preserves the version numbers',async()=>{
 const f=fixture({initial:available});await tick();
 assert.equal(f.find('.update-current').textContent,'v0.6.19');
 assert.equal(f.find('.update-next').textContent,'v0.6.20');
 const items=walk(f.find('.update-notes')).filter(node=>node.tagName==='li');
 assert.deepEqual(items.map(node=>node.textContent),['Clearer text','<img src=x onerror=alert(1)>']);
 assert(items.every(node=>!node.children.length));
 assert.equal(f.find('.update-action').textContent,'Download update');
});
test('download/install actions follow native phases; closing the dialog does not cancel download',async()=>{
 const f=fixture({initial:available});await tick();f.open();
 f.find('.update-action').click();await tick();
 assert.deepEqual(f.calls,['download']);assert.equal(f.find('.update-action').textContent,'Restart and install');
 f.emit({...available,phase:'downloading',progress:63.8,message:'正在下载 63%'});
 assert.equal(f.find('progress').value,63);assert.equal(f.find('.update-percent').textContent,'63%');
 assert.equal(f.find('.update-action').disabled,true);
 f.find('.update-dismiss').click();assert.equal(f.panel.open,false);
 f.emit({...available,phase:'downloaded'});f.open();f.find('.update-action').click();await tick();
 assert.deepEqual(f.calls,['download','install']);assert.equal(f.panel.dataset.phase,'installing');
});
test('failed and repeated checks unlock retry and never leave a permanently checking dialog',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const f=fixture({check:async()=>{await pending;throw new Error('更新检查超时，请稍后重试。');}});await tick();
 f.entry.click();f.entry.click();assert.deepEqual(f.calls,['check']);assert.equal(f.find('.update-action').disabled,true);
 release();await tick();
 assert.equal(f.panel.dataset.phase,'error');assert.equal(f.find('.update-action').disabled,false);
 assert.equal(f.find('.update-status').textContent,i18n.translate('更新检查超时，请稍后重试。','en'));
 f.find('.update-action').click();await tick();assert.deepEqual(f.calls,['check','check']);
});
test('language switching updates status, actions and the authored release summary',async()=>{
 const f=fixture({initial:{...available,phase:'downloaded',message:'下载完成，点击重启并安装。'}});await tick();
 const notes=walk(f.find('.update-notes')).filter(node=>node.tagName==='li').map(node=>node.textContent);
 for(const code of ['ja','de','fr','es','pt-BR','ko','hi','zh-CN','en']){
  f.language(code);
  assert.equal(f.find('.update-action').textContent,i18n.translate('重启并安装',code));
  assert.equal(f.find('.update-status').textContent,i18n.translate('下载完成，点击重启并安装。',code));
  assert.deepEqual(walk(f.find('.update-notes')).filter(node=>node.tagName==='li').map(node=>node.textContent),notes);
 }
});
test('a cancelled native install stays downloadable and a current version hides the candidate',async()=>{
 const downloaded={...available,phase:'downloaded'};
 const f=fixture({initial:downloaded,install:async()=>downloaded});await tick();
 f.find('.update-action').click();await tick();
 assert.equal(f.find('.update-action').disabled,false);assert.equal(f.panel.dataset.phase,'downloaded');
 f.emit({phase:'current',currentVersion:'0.6.19'});
 assert.equal(f.find('.update-next-wrap').hidden,true);assert.equal(f.find('.update-release').hidden,true);
 assert.equal(f.find('progress').hidden,true);
});

test('cross-version history filters numerically, sorts, collapses older releases and keeps notices visible',async()=>{
 const releases=['0.6.9','0.6.13','0.6.10','0.6.11','0.6.12','0.6.14'].map(version=>summary(version,[version]));
 releases.find(r=>r.version==='0.6.10').important=Object.fromEntries(i18n.locales.map(({code})=>[code,['Keep this notice visible.']]));
 const f=fixture({initial:{...available,currentVersion:'0.6.9',version:'0.6.13',releases}});await tick();
 const nodes=walk(f.find('.update-notes')),history=nodes.find(n=>n.tagName==='details');
 assert.deepEqual(nodes.filter(n=>n.tagName==='h4').map(n=>n.textContent),['v0.6.13','v0.6.12','v0.6.11','v0.6.10']);
 assert.equal(history.open,false);assert.equal(history.children[0].textContent,'1 earlier versions');
 const notice=nodes.find(n=>n.className==='update-important');assert(notice);assert(!walk(history).includes(notice));
 history.open=true;f.language('ja');assert.equal(walk(f.find('.update-notes')).find(n=>n.tagName==='details').open,true);
 f.emit({...available,currentVersion:'0.6.9',version:'0.6.13',releases,phase:'downloading',progress:25});
 assert.equal(walk(f.find('.update-notes')).find(n=>n.tagName==='details').open,true);
 assert(f.find('.update-details-link').href.endsWith('/tag/v0.6.13'));
});
test('authored summaries and important notices follow all nine languages without changing the update phase',async()=>{
 const releases=require('../docs/update-summaries.json');
 const f=fixture({initial:{...available,currentVersion:'0.6.20',version:'0.6.23',releases,phase:'downloaded'}});await tick();
 for(const {code} of i18n.locales){
  f.language(code);
  const text=walk(f.find('.update-notes')).map(n=>n.textContent);
  for(const release of releases.filter(r=>['0.6.23','0.6.22','0.6.21'].includes(r.version))){
   for(const line of release.summary[code])assert(text.includes(line),code+': '+line);
   for(const line of release.important?.[code]||[])assert(text.includes(line));
  }
  assert.equal(f.panel.dataset.phase,'downloaded');
 }
});
test('legacy metadata stays readable on demand without claiming complete multilingual history',async()=>{
 const f=fixture({initial:{...available,releases:undefined}});await tick();
 const nodes=walk(f.find('.update-notes')),details=nodes.find(n=>n.tagName==='details');
 assert(details);assert(!details.open);
 assert(nodes.some(n=>n.textContent==='<img src=x onerror=alert(1)>'));
 assert(!nodes.some(n=>n.textContent==='Old changes'));
 assert(!nodes.some(n=>n.className==='update-release-count'));
});
