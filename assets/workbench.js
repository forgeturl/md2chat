(() => {
 'use strict';
 if (window.md2chatDesktop) document.body.classList.add('desktop-app');
 for (const trigger of document.querySelectorAll('[data-open-dialog]')) {
  const panel = document.getElementById(trigger.dataset.openDialog);
  trigger.addEventListener('click', () => {
   if (!panel.open) panel.showModal();
  });
 }
 for (const close of document.querySelectorAll('[data-close-dialog]')) {
  close.addEventListener('click', () => close.closest('dialog').close());
 }
 const tabs = [...document.querySelectorAll('[data-help-tab]')];
 function selectTab(selected, focus = false) {
  for (const tab of tabs) {
   const active = tab === selected;
   tab.setAttribute('aria-selected', String(active));tab.tabIndex = active ? 0 : -1;
   document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
  document.querySelector('.help-content').scrollTop = 0;
  if (focus) selected.focus();
 }
 for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
   const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : event.key === 'ArrowRight' ? (index + 1) % tabs.length
     : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
   if (target !== null) {event.preventDefault();selectTab(tabs[target], true);}
  });
 }
})();
