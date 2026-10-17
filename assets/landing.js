(() => {
 const input=document.getElementById('demo-source'),preview=document.getElementById('demo-preview');
 const loading=document.getElementById('demo-loading'),status=document.getElementById('demo-status');
 const error=document.getElementById('demo-error'),retry=document.getElementById('demo-retry'),reset=document.getElementById('demo-reset');
 let generation=0,pending=null,running=false,timer,edited=false,composing=false,locale;
 function busy() {
  preview.classList.toggle('is-example',!edited);
  loading.hidden=false;error.hidden=true;status.textContent=md2chatI18n.t('正在生成预览…');
  preview.setAttribute('aria-busy','true');preview.dataset.state='loading';
 }
 async function drain() {
  if(running)return;
  running=true;
  try {
   while(pending) {
    const task=pending;pending=null;
    try {
     // Give the loading indicator a frame before starting a cold renderer.
     await new Promise(requestAnimationFrame);
     if(task.generation!==generation)continue;
     const content=await md2chatDemo.render(task.source,ChatMarkdown,ChatRenderers,document,{isCurrent:()=>task.generation===generation});
     if(task.generation!==generation)continue;
     preview.replaceChildren(content);preview.scrollTop=0;preview.dataset.state=task.source.trim()?'ready':'empty';
     preview.setAttribute('aria-busy','false');loading.hidden=true;
    } catch(_) {
     if(task.generation!==generation)continue;
     // Never leave an old successful result beside a new invalid source.
     preview.replaceChildren();preview.setAttribute('aria-busy','false');preview.dataset.state='error';loading.hidden=true;error.hidden=false;
    }
   }
  } finally {running=false;}
 }
 function schedule(delay=300) {
  generation++;pending=null;clearTimeout(timer);busy();
  if(composing)return;
  timer=setTimeout(()=>{pending={source:input.value,generation};void drain();},delay);
 }
 function seed() {
  edited=false;input.dataset.edited='false';reset.disabled=true;input.value=md2chatDemo.source(md2chatI18n.t);schedule(0);
 }
 input.addEventListener('input',()=>{edited=true;input.dataset.edited='true';reset.disabled=false;schedule();});
 input.addEventListener('compositionstart',()=>{composing=true;generation++;pending=null;clearTimeout(timer);});
 input.addEventListener('compositionend',()=>{composing=false;edited=true;input.dataset.edited='true';reset.disabled=false;schedule();});
 reset.addEventListener('click',()=>{seed();input.focus();});retry.addEventListener('click',()=>schedule(0));
 function language() {
  const changed=locale!==md2chatI18n.locale;locale=md2chatI18n.locale;
  if(changed&&!edited)seed();
  else if(!loading.hidden)status.textContent=md2chatI18n.t('正在生成预览…');
 }
 window.addEventListener('md2chat:language',language);
 if(document.readyState!=='loading')language();
})();
