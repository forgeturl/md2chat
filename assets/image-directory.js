/* Per-conversion directory prompt. Paths and image bytes are never persisted. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ImageDirectory=api;})(globalThis,root=>{
 function isRelative(source){return typeof source==='string'&&!!source&&!/^[\\/]|^[a-z][a-z\d+.-]*:|[\x00-\x1f\x7f]/i.test(source);}
 function cancelled(){return Object.assign(new Error('转换已取消。'),{cancelled:true});}
 function createView({document=root.document,t=(key,values={})=>(root.md2chatI18n?.t(key)||key).replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''))}={}){
  let current;
  const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;};
  return {
   open(actions){
    const dialog=element('dialog','utility-dialog image-directory-dialog');dialog.dataset.noI18n='';dialog.setAttribute('aria-labelledby','image-directory-title');
    const heading=element('header','dialog-heading'),title=element('h2'),close=element('button','dialog-close','×');title.id='image-directory-title';close.type='button';
    heading.append(title,close);
    const form=element('form','image-directory-form'),help=element('p','help'),label=element('label'),input=element('input'),summary=element('p','image-directory-status');
    input.id='image-directory-path';input.type='text';input.autocomplete='off';input.spellcheck=false;label.htmlFor=input.id;summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
    const details=element('details','image-directory-references'),detailsTitle=element('summary'),list=element('ul');details.append(detailsTitle,list);
    const footer=element('footer','image-directory-actions'),ignore=element('button','image-directory-ignore'),skip=element('span','image-directory-skip'),spacer=element('span','image-directory-spacer'),cancel=element('button','update-close'),submit=element('button');
    const confirmActions=element('div','image-directory-confirm-actions');confirmActions.append(cancel,submit);
    ignore.type='button';cancel.type='button';submit.type='submit';footer.append(ignore,skip,spacer,confirmActions);
    form.append(help,label,input,summary,details,footer);dialog.append(heading,form);document.body.append(dialog);
    const state={dialog,title,close,help,label,input,summary,detailsTitle,list,ignore,skip,cancel,submit,model:null};current=state;
    const refresh=()=>{if(state.model)this.update(state.model);};state.refresh=refresh;root.addEventListener?.('md2chat:language',refresh);
    form.addEventListener('submit',event=>{event.preventDefault();void actions.submit(input.value);});
    ignore.addEventListener('click',()=>{void actions.ignore(input.value);});
    for(const button of [close,cancel])button.addEventListener('click',actions.cancel);
    dialog.addEventListener('cancel',event=>{event.preventDefault();actions.cancel();});dialog.addEventListener('close',actions.cancel);
    input.addEventListener('input',()=>actions.input());
    dialog.showModal();input.focus();
   },
   update(model){
    const state=current;if(!state)return;state.model=model;
    state.title.textContent=t('补充图片目录');state.close.setAttribute('aria-label',t('关闭'));state.help.textContent=t('填写目录以读取图片，也可忽略图片继续。');state.label.textContent=t('Markdown 所在目录');
    state.input.placeholder=t('输入或粘贴目录路径');state.input.disabled=model.checking;
    state.summary.textContent=model.checking?t('正在检查图片…'):model.failures.length?t('已读取 {loaded} 张，{missing} 张无法读取。',model):'';
    state.summary.classList.toggle('has-error',model.failures.length>0);state.input.setAttribute('aria-invalid',String(model.failures.length>0));
    state.detailsTitle.textContent=t('图片引用（{n}）',{n:model.total});state.list.replaceChildren();
    for(const resource of model.resources){const item=element('li'),reference=element('span','image-directory-reference',resource),failure=model.failures.find(value=>value.resource===resource);item.append(reference);if(failure){if(failure.resolvedPath)item.append(element('span','image-directory-resolved',failure.resolvedPath));item.append(element('span','image-directory-reason',t(failure.reason)));}state.list.append(item);}
    state.ignore.textContent=t('忽略并继续');state.ignore.disabled=model.checking;state.skip.textContent=t('将跳过 {n} 张图片。',{n:model.missing});state.cancel.textContent=t('取消');state.submit.textContent=t(model.checking?'检查中…':'确定');state.submit.disabled=model.checking||!state.input.value.trim();
   },
   close(){const state=current;if(!state)return;current=null;root.removeEventListener?.('md2chat:language',state.refresh);state.dialog.close();state.dialog.remove();}
  };
 }
 function create({load,view,...viewOptions}){
  view ||= createView(viewOptions);let active;
  function cancel(){active?.finish(null,cancelled());}
  async function request(resources,{waiting=async()=>{}}={}){
   cancel();
   let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
   const state={resources:[...resources],disposed:false,checking:false,failures:[],loaded:0,missing:resources.length,epoch:0};active=state;
   let reportedWaiting;
   const reportWaiting=(value,directory)=>{if(reportedWaiting===value)return Promise.resolve();reportedWaiting=value;return Promise.resolve().then(()=>waiting(value,directory));};
   const update=()=>view.update({...state,total:resources.length});
   state.finish=(value,error)=>{
    if(state.disposed)return;state.disposed=true;state.epoch++;if(active===state)active=null;view.close();
    reportWaiting(false).catch(()=>{}).then(()=>error?reject(error):resolve(value));
   };
   async function inspect(rawDirectory,ignore){
    if(state.disposed||state.checking)return;
    const directory=rawDirectory.trim();if(!directory&&!ignore)return;
    state.checking=true;state.failures=[];const epoch=++state.epoch;update();const values=new Map();
    try{await reportWaiting(false,directory);}catch(error){state.finish(null,error);return;}
    for(const resource of new Set(resources)){
     if(state.disposed||epoch!==state.epoch)return;
     if(!directory){values.set(resource,null);continue;}
     try{values.set(resource,await load(resource,directory));}
     catch(error){values.set(resource,null);state.failures.push({resource,reason:error.message,resolvedPath:error.resolvedPath});}
    }
    if(state.disposed||epoch!==state.epoch)return;
    state.loaded=resources.filter(resource=>values.get(resource)!==null).length;state.missing=resources.length-state.loaded;state.checking=false;
    if(!state.missing||ignore)state.finish(values);
    else{try{await reportWaiting(true);}catch(error){state.finish(null,error);return;}if(!state.disposed)update();}
   }
   try{await reportWaiting(true);if(!state.disposed){view.open({submit:directory=>inspect(directory,false),ignore:directory=>inspect(directory,true),cancel:()=>state.finish(null,cancelled()),input(){if(!state.disposed){state.failures=[];state.loaded=0;state.missing=resources.length;update();}}});update();}}
   catch(error){state.finish(null,error);}
   return result;
  }
  return {request,cancel};
 }
 return {isRelative,create,createView,cancelled};
});
