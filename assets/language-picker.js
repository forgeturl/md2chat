/* Progressive enhancement: the existing native select remains the locale controller. */
(() => {
 'use strict';
 const icons = new URL('./ui-icons/', document.currentScript.src);
 let nextId = 0;
 function enhance(select) {
  const wrapper = document.createElement('div'); wrapper.className = 'language-picker'; wrapper.dataset.noI18n = '';
  select.before(wrapper); wrapper.appendChild(select);
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'language-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  const icon = name => { const img = document.createElement('img'); img.src = new URL(name+'.svg',icons).href; img.alt=''; img.width=18; img.height=18; return img; };
  const label = document.createElement('span'), badge = document.createElement('span'); badge.className = 'language-auto';
  trigger.append(icon('languages'),label,badge,icon('chevron-down'));
  const panel = document.createElement('div'); panel.className = 'language-menu'; panel.id = 'language-menu-'+(++nextId); panel.hidden = true;
  trigger.setAttribute('aria-controls',panel.id);
  const heading = document.createElement('div'); heading.className = 'language-menu-heading';
  const list = document.createElement('div'); list.className = 'language-options'; list.setAttribute('role','listbox');
  list.setAttribute('aria-labelledby',panel.id+'-heading'); heading.id = panel.id+'-heading';
  panel.append(heading,list); wrapper.append(trigger,panel);
  select.hidden = true;
  let options = [];
  function close(focus=false) { panel.hidden=true; trigger.setAttribute('aria-expanded','false'); if(focus)trigger.focus(); }
  function sync() {
   const api = window.md2chatI18n;
   trigger.disabled = select.disabled;
   const current = api.locales.find(item=>item.code===api.locale);
   label.textContent = current?.name || 'English'; badge.textContent=api.t('自动'); badge.hidden=api.preference!=='auto';
   trigger.setAttribute('aria-label',api.t('语言')+' · '+label.textContent);
   heading.textContent=api.t('语言');
   list.replaceChildren(); options=[];
   for(const option of select.options) {
    const button=document.createElement('button'); button.type='button'; button.className='language-option'; button.tabIndex=-1;
    button.setAttribute('role','option'); button.dataset.value=option.value;
    button.setAttribute('aria-selected',String(option.value===select.value));
    const name=document.createElement('span');name.textContent=option.value==='auto'?api.t('跟随浏览器'):option.textContent;
    button.append(name,icon('check'));
    if(option.value==='auto')button.classList.add('language-follow-browser');
    button.addEventListener('click',()=>{
     if(select.disabled)return;
     select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));close(true);
    });
    button.addEventListener('keydown',event=>{
     const index=options.indexOf(button);let next;
     if(event.key==='ArrowDown')next=(index+1)%options.length;
     if(event.key==='ArrowUp')next=(index+options.length-1)%options.length;
     if(event.key==='Home')next=0;
     if(event.key==='End')next=options.length-1;
     if(next!==undefined){event.preventDefault();options[next].focus();}
    });
    list.appendChild(button);options.push(button);
   }
  }
  function open() {
   if(select.disabled)return;
   sync();panel.hidden=false;trigger.setAttribute('aria-expanded','true');
   panel.style.transform='';
   const rect=trigger.getBoundingClientRect(),below=window.innerHeight-rect.bottom;
   panel.classList.toggle('opens-up',below<panel.offsetHeight+12 && rect.top>below);
   const bounds=panel.getBoundingClientRect();
   const shift=Math.max(16-bounds.left,Math.min(0,window.innerWidth-16-bounds.right));
   if(shift)panel.style.transform='translateX('+shift+'px)';
   (options.find(option=>option.dataset.value===select.value)||options[0])?.focus();
  }
  trigger.addEventListener('click',()=>panel.hidden?open():close());
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();}});
  wrapper.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();close(true);}});
  wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget))close();});
  document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();});
  window.addEventListener('md2chat:language',sync);
  new MutationObserver(()=>{trigger.disabled=select.disabled;}).observe(select,{attributes:true,attributeFilter:['disabled']});
  sync();
 }
 function init(){for(const select of document.querySelectorAll('[data-locale-select]'))enhance(select);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
