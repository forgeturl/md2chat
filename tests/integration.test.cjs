const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loginOptions,loginState,setLogin,startHidden,createIntegration}=require('../desktop/integration.cjs');
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
test('tray setup never enables startup; its menu re-reads OS state and quit destroys tray',()=>{
 let enabled=false,writes=0,menu,shown=0,quit=0,destroyed=0;const handlers={};
 const app={isPackaged:true,getLoginItemSettings:()=>({openAtLogin:enabled,status:enabled?'enabled':'not-registered'}),setLoginItemSettings(s){writes++;enabled=s.openAtLogin;},quit(){quit++;}};
 class Tray{setToolTip(){}on(name,fn){handlers[name]=fn;}popUpContextMenu(items){menu=items;}destroy(){destroyed++;}}
 const Menu={buildFromTemplate:x=>x,setApplicationMenu(){}};
 const integration=createIntegration({app,Tray,Menu,nativeImage:{createFromPath:()=>({isEmpty:()=>false,resize:()=>({})})},dialog:{showErrorBox(){assert.fail();}},showWindow:()=>shown++,platform:'darwin'});
 assert.equal(writes,0);assert.equal(integration.hasTray,true);
 handlers.click();assert.equal(menu.find(x=>x.type==='checkbox').checked,false);
 enabled=true;handlers.click();assert.equal(menu.find(x=>x.type==='checkbox').checked,true);
 menu[0].click();assert.equal(shown,1);menu.at(-1).click();assert.equal(quit,1);
 integration.destroy();assert.equal(destroyed,1);assert.equal(integration.hasTray,false);
});
test('tray creation failure leaves window-close fallback available',()=>{
 let errors=0;
 const integration=createIntegration({app:{isPackaged:false},Tray:class {},Menu:{buildFromTemplate:x=>x,setApplicationMenu(){}},nativeImage:{createFromPath:()=>({isEmpty:()=>true})},dialog:{showErrorBox(){errors++;}},showWindow(){},platform:'win32'});
 assert.equal(integration.hasTray,false);assert.equal(errors,1);
});
test('Mac application outside Applications cannot register a temporary login target',()=>{
 const app={isPackaged:true,isInApplicationsFolder:()=>false};
 assert.equal(loginState(app,'darwin','/tmp/md2chat.app').supported,false);
 assert.throws(()=>setLogin(app,'darwin','/tmp/md2chat.app',true));
});
