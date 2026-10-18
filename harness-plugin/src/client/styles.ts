/**
 * Plugin-owned stylesheet, injected once per page. Class names carry the
 * plugin prefix; colors come from the shell's --dsw-* tokens. The action
 * button mirrors ui-message-feedback's .action so it matches its siblings.
 */
const CSS = `
.md2chat-share-action{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.md2chat-share-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}
.md2chat-share-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.md2chat-share-dialog{width:min(560px,calc(100vw - 48px))}
.md2chat-share-status{margin:0 0 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.md2chat-share-status[data-error]{color:var(--dsw-alias-label-danger,#d93026)}
.md2chat-share-preview{max-height:300px;overflow:auto;margin-bottom:16px;padding:12px;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.25));border-radius:var(--dsw-radius-md,8px);background:#fff;color:#202938;font-size:14px;line-height:1.5}
.md2chat-share-preview img{max-width:100%;height:auto}
.md2chat-share-targets{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.md2chat-share-target{padding:10px 0;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.25));border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer}
.md2chat-share-target:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.md2chat-share-target:disabled{cursor:not-allowed;opacity:.45}
`

const TAG_ID = 'md2chat-dsh-share'

/** Insert the stylesheet once; returns its remover for the plugin's lifecycle. */
export function injectStyles(): () => void {
  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
