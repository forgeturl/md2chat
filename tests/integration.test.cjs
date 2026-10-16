const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loginOptions,loginState,setLogin,startHidden,createIntegration}=require('../desktop/integration.cjs');
function nativeImageStub(emptyTray=false){
 return {createFromPath(source){const image={source,isEmpty:()=>emptyTray&&source.replaceAll('\\','/').endsWith('/assets/menu-icons/tray.png'),resize:()=>image,setTemplateImage(){}};return image;}};
}
test('Windows startup uses the same executable and arguments for reading and writing',()=>{
 const calls=[];let enabled=false;
 const app={isPackaged:true,getLoginItemSettings(options){calls.push(['get',options]);return {openAtLogin:enabled,executableWillLaunchAtLogin:enabled};},setLoginItemSettings(options){calls.push(['set',options]);enabled=options.openAtLogin;}};
 const exe='C:\\Users\\Sample User\\md2chat\\md2chat.exe';
 assert.equal(setLogin(app,'win32',exe,true).enabled,true);
 assert.deepEqual(calls[1],['set',{path:exe,args:['--autostart'],openAtLogin:true,enabled:true}]);
 assert.deepEqual(calls[0][1],calls[2][1]);
 assert.equal(setLogin(app,'win32',exe,false).enabled,false);
 assert.equal(startHidden(app,'win32',['--autostart'],exe),true);
 assert.equal(startHidden(app,'win32',[],exe),false);
});
test('macOS pending approval and OS-disabled Windows items are not reported as enabled',()=>{
 const app={isPackaged:true,getLoginItemSettings:()=>({openAtLogin:true,status:'requires-approval'})};
 assert.equal(loginState(app,'darwin','/app').enabled,false);
 assert.equal(loginState(app,'darwin','/app').pending,true);
 app.getLoginItemSettings=()=>({openAtLogin:true,executableWillLaunchAtLogin:false});
 assert.equal(loginState(app,'win32','app.exe').enabled,false);
 app.getLoginItemSettings=()=>({openAtLogin:true,wasOpenedAtLogin:true,status:'enabled'});
 assert.equal(startHidden(app,'darwin',[],'/app'),true);
 assert.deepEqual(loginOptions('darwin','/app'),{});
});
test('development builds cannot register Electron as a login item',()=>{
 const app={isPackaged:false,setLoginItemSettings(){throw new Error('must not be called');}};
 assert.equal(loginState(app,'darwin','/electron').supported,false);
 assert.throws(()=>setLogin(app,'darwin','/electron',true),/安装/);
});
test('tray setup never enables startup and quit destroys tray',()=>{
 let enabled=false,writes=0,menu,shown=0,quit=0,destroyed=0;const handlers={};
 const app={isPackaged:true,getLoginItemSettings:()=>({openAtLogin:enabled,status:enabled?'enabled':'not-registered'}),setLoginItemSettings(s){writes++;enabled=s.openAtLogin;},quit(){quit++;}};
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){destroyed++;}}
 const Menu={buildFromTemplate:x=>x,setApplicationMenu(){}};
 const integration=createIntegration({app,Tray,Menu,nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow:()=>shown++,platform:'darwin'});
 assert.equal(writes,0);assert.equal(integration.hasTray,true);
 handlers.click();assert.equal(menu.some(item=>item.type==='checkbox'),false);assert.equal(writes,0);
 menu[0].click();assert.equal(shown,1);menu.at(-1).click();assert.equal(quit,1);
 integration.destroy();assert.equal(destroyed,1);assert.equal(integration.hasTray,false);
});
test('tray creation failure leaves window-close fallback available',()=>{
 let errors=0;
 const integration=createIntegration({app:{isPackaged:false},Tray:class {},Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:nativeImageStub(true),dialog:{showErrorBox(){errors++;}},showWindow(){},platform:'win32'});
 assert.equal(integration.hasTray,false);assert.equal(errors,1);
});
test('Mac application outside Applications cannot register a temporary login target',()=>{
 const app={isPackaged:true,isInApplicationsFolder:()=>false};
 assert.equal(loginState(app,'darwin','/tmp/md2chat.app').supported,false);
 assert.throws(()=>setLogin(app,'darwin','/tmp/md2chat.app',true));
});
for(const platform of ['darwin','win32'])test(platform+' tray converts clipboard for every supported platform without showing the editor',()=>{
 let menu,shown=0,images=0;const handlers={},converted=[];
 const app={isPackaged:false,quit(){}};
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){}}
 const integration=createIntegration({app,Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow:()=>shown++,convertClipboard:target=>converted.push(target),convertClipboardToImage:()=>images++,platform});
 handlers[platform==='darwin'?'click':'right-click']();
 const conversion=menu.find(item=>item.label==='剪贴板转换'),items=conversion.submenu;
 assert.deepEqual(items.map(item=>item.label),['转图片','微信格式','钉钉格式','飞书格式','企业微信格式','邮件格式']);
 assert.deepEqual(menu.map(item=>item.label||item.type),['剪贴板转换','separator','显示主窗口','首选项','帮助 ↗','检查更新','separator','退出 md2chat']);
 assert.equal(conversion.enabled,true);
 for(const item of items.slice(1)){assert.equal(item.enabled,true);item.click({},{});}
 assert.deepEqual(converted,['wechat','dingtalk','feishu','wecom','email']);assert.equal(shown,0);
 items[0].click();assert.equal(images,1);assert.equal(shown,0);
 menu.find(item=>item.label==='显示主窗口').click();assert.equal(shown,1);
 if(platform==='win32'){handlers.click();assert.equal(shown,2);handlers['double-click']();assert.equal(shown,3);}
 integration.destroy();
});
test('tray re-reads conversion state on each popup and disables shortcuts while busy',()=>{
 let busy=false,menu;const handlers={};
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){}}
 createIntegration({app:{isPackaged:false},Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow(){},convertClipboard(){},convertClipboardToImage(){},getClipboardConversionState:()=>({busy}),platform:'darwin'});
 handlers.click();assert.equal(menu[0].label,'剪贴板转换');assert.equal(menu[0].enabled,true);
 assert(menu[0].submenu.every(item=>item.enabled));assert.equal(menu[0].submenu[0].label,'转图片');
 busy=true;handlers.click();
 assert.equal(menu[0].label,'正在转换…');assert.equal(menu[0].enabled,false);
 assert.equal(menu[0].submenu.length,6);
 assert(menu[0].submenu.every(item=>item.enabled===false));
 busy=false;handlers.click();assert.equal(menu[0].label,'剪贴板转换');
 assert.equal(menu[0].enabled,true);assert(menu[0].submenu.every(item=>item.enabled));
});
test('tray does not offer clipboard conversion without a conversion callback',()=>{
 let menu;const handlers={};
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){}}
 createIntegration({app:{isPackaged:false},Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow(){},platform:'win32'});
 handlers['right-click']();assert.equal(menu.some(item=>item.label?.includes('剪贴板')),false);
 assert.equal(menu.some(item=>item.label==='转图片'),false);
 assert.equal(menu[1].label,'首选项');
});
test('image conversion remains available without platform conversion',()=>{
 let menu,images=0;const handlers={};
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){}}
 createIntegration({app:{isPackaged:false},Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow(){},convertClipboardToImage:()=>images++,platform:'win32'});
 handlers['right-click']();assert.equal(menu[0].label,'剪贴板转换');
 assert.deepEqual(menu[0].submenu.map(item=>item.label),['转图片']);
 assert.equal(menu.some(item=>item.label==='转图片'),false);
 menu[0].submenu[0].click();assert.equal(images,1);
});
for(const platform of ['darwin','win32'])test(platform+' preferences opens its own window from tray and application menu',()=>{
 let menu,applicationMenu,opened=0;const handlers={};
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){}}
 createIntegration({app:{isPackaged:false},Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(items){applicationMenu=items;}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow(){assert.fail('preferences must open its own window');},openPreferences:()=>opened++,platform});
 handlers[platform==='darwin'?'click':'right-click']();
 for(const items of [menu,applicationMenu[0].submenu]){
  const preferences=items.find(item=>item.label==='首选项');
  assert.equal(preferences.submenu,undefined);preferences.click();
 }
 assert.equal(opened,2);
 assert.equal(applicationMenu[0].submenu.find(item=>item.label==='首选项').accelerator,platform==='darwin'?'Command+,':undefined);
 assert.equal(applicationMenu.some(item=>item.label==='首选项'),false);
 assert(applicationMenu.every(item=>!item.label||Array.isArray(item.submenu)));
});
for(const platform of ['darwin','win32'])test(platform+' help links directly to issues while updates remain independent',async()=>{
 let menu,updates=0,applicationMenu;const handlers={},external=[];
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){}}
 createIntegration({app:{isPackaged:false},Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(items){applicationMenu=items;}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},shell:{openExternal:async url=>external.push(url)},showWindow(){assert.fail('help and update must use their own callbacks');},checkUpdates:()=>updates++,platform});
 handlers[platform==='darwin'?'click':'right-click']();
 const help=menu.find(item=>item.label==='帮助 ↗');
 assert.equal(help.submenu,undefined);await help.click();
 assert.deepEqual(external,['https://github.com/forgeturl/md2chat/issues']);
 assert.equal(menu.some(item=>item.label==='反馈问题'),false);
 menu.find(item=>item.label==='检查更新').click();assert.equal(updates,1);
 assert.equal(applicationMenu[0].submenu.find(item=>item.label==='首选项').submenu,undefined);
 const applicationHelp=applicationMenu[0].submenu.find(item=>item.label==='帮助 ↗');
 assert.equal(applicationHelp.submenu,undefined);await applicationHelp.click();
 assert.deepEqual(external,['https://github.com/forgeturl/md2chat/issues','https://github.com/forgeturl/md2chat/issues']);
 assert.equal(applicationMenu.some(item=>item.label==='帮助'||item.label==='帮助 ↗'),false);
 applicationMenu[0].submenu.find(item=>item.label==='检查更新').click();assert.equal(updates,2);
 if(platform==='darwin'){
  assert.equal(applicationMenu[0].role,'appMenu');
  assert.deepEqual(applicationMenu[0].submenu.filter(item=>item.role).map(item=>item.role),['about','services','hide','hideOthers','unhide','quit']);
 }else assert.deepEqual(applicationMenu[0].submenu.map(item=>item.label||item.type),['显示主窗口','首选项','帮助 ↗','检查更新','separator','退出 md2chat']);
});
for(const platform of ['darwin','win32'])test(platform+' pinned platforms retain chosen order, ignore invalid duplicates, and remain in the full submenu',()=>{
 let menu,busy=false,value={pinnedTargets:['email','wechat','email','unknown',null,'toString',{},'dingtalk','wechat']};const handlers={},converted=[];
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){}}
 const integration=createIntegration({app:{isPackaged:false},Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow(){},convertClipboard:target=>converted.push(target),getPreferences:()=>value,getClipboardConversionState:()=>({busy}),platform});
 const popup=handlers[platform==='darwin'?'click':'right-click'];
 popup();assert.deepEqual(menu.slice(0,3).map(item=>item.label),['邮件格式','微信格式','钉钉格式']);
 for(const item of menu.slice(0,3)){assert.equal(item.enabled,true);item.click();}
 assert.deepEqual(converted,['email','wechat','dingtalk']);
 assert.deepEqual(menu.find(item=>item.label==='剪贴板转换').submenu.map(item=>item.label),['微信格式','钉钉格式','飞书格式','企业微信格式','邮件格式']);
 value={pinnedTargets:['wecom','feishu']};integration.refreshTray();popup();
 assert.deepEqual(menu.slice(0,2).map(item=>item.label),['企业微信格式','飞书格式']);
 for(const item of menu.slice(0,2))item.click();assert.deepEqual(converted,['email','wechat','dingtalk','wecom','feishu']);
 busy=true;popup();assert(menu.slice(0,3).every(item=>item.enabled===false));
 assert(menu.find(item=>item.label==='正在转换…').submenu.every(item=>item.enabled===false));
 for(const invalid of [null,undefined,{},'wechat',{pinnedTargets:'wechat'},{pinnedTargets:[]},{pinnedTargets:['unknown','toString',null,{}]},{pinnedTarget:'wechat'}]){
  value=invalid;busy=false;popup();assert.equal(menu[0].label,'剪贴板转换');
 }
});
for(const platform of ['darwin','win32'])test(platform+' tray title follows the preference only on macOS',()=>{
 let value={};const titles=[],handlers={};
 class Tray{setTitle(title){titles.push(title);}setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(){}destroy(){}}
 const integration=createIntegration({app:{isPackaged:false},Tray,Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:nativeImageStub(),dialog:{showErrorBox(){assert.fail();}},showWindow(){},getPreferences:()=>value,platform});
 assert.deepEqual(titles,platform==='darwin'?['']:[]);
 value={showTrayLabel:true};integration.refreshTray();assert.deepEqual(titles,platform==='darwin'?['','md2chat']:[]);
 value={showTrayLabel:false};integration.refreshTray();assert.deepEqual(titles,platform==='darwin'?['','md2chat','']:[]);
 value={};handlers[platform==='darwin'?'click':'right-click']();assert.deepEqual(titles,platform==='darwin'?['','md2chat','','']:[]);
});
