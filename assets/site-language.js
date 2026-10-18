// Native links navigate to complete static translations, even without JS.
(() => {
 for(const picker of document.querySelectorAll('.site-language-picker')){
  const trigger=picker.querySelector('summary');
  picker.addEventListener('keydown',event=>{if(event.key==='Escape'&&picker.open){event.preventDefault();picker.open=false;trigger.focus();}});
  picker.addEventListener('focusout',event=>{if(!picker.contains(event.relatedTarget))picker.open=false;});
  document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))picker.open=false;});
 }
})();
