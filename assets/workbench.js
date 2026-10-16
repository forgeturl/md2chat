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
})();
