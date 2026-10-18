/**
 * The Share entry in an assistant reply's action strip, and its dialog:
 * conversion starts when the dialog opens, and a target click copies in that
 * target's mode (convert.ts copyMode).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconShareOutlineRegular, Modal, Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { convert, copyLongImage, copyMode, copyNative, copyRich, TARGETS, type Payload, type Target } from './convert.ts'
import type { ShareKey } from './locales.ts'

type Translate = (key: ShareKey, params?: Record<string, unknown>) => string

/** Injected face of the assistant-actions entry. */
export interface ShareInjected {
  /** Markdown of the reply's final assistant message, read on click. */
  getMarkdown: (messageId: string) => string
}

export type ShareActionProps = { messageId: string; t: Translate } & ShareInjected

type Conversion =
  | { kind: 'converting' }
  | { kind: 'ready'; payload: Payload }
  | { kind: 'failed'; message: string }

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function ShareAction({ messageId, getMarkdown, t }: ShareActionProps) {
  const [source, setSource] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const open = useCallback(() => { setSource(getMarkdown(messageId)) }, [getMarkdown, messageId])
  const close = useCallback(() => { setSource(null) }, [])
  const copied = useCallback((text: string) => { setSource(null); setToast(text) }, [])

  return (
    <>
      <Tooltip label={t('action.share')} side="bottom">
        <button type="button" className="md2chat-share-action" aria-label={t('action.share')} onClick={open}>
          <IconShareOutlineRegular />
        </button>
      </Tooltip>
      {source !== null && <ShareDialog source={source} t={t} onClose={close} onCopied={copied} />}
      {toast !== null && <Toast text={toast} tone="success" holdMs={4000} onDone={() => { setToast(null) }} />}
    </>
  )
}

function ShareDialog({ source, t, onClose, onCopied }: {
  source: string
  t: Translate
  onClose: () => void
  onCopied: (toast: string) => void
}) {
  const empty = source.trim() === ''
  const conversion = useMemo(() => (empty ? null : convert(source)), [empty, source])
  const [state, setState] = useState<Conversion>({ kind: 'converting' })
  const [copyError, setCopyError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (conversion === null) return
    let alive = true
    conversion.then(
      (payload) => { if (alive) setState({ kind: 'ready', payload }) },
      (error: unknown) => { if (alive) setState({ kind: 'failed', message: errorMessage(error) }) },
    )
    return () => { alive = false }
  }, [conversion])

  const fail = useCallback((error: unknown) => {
    setBusy(false)
    // A failed conversion already explains itself in the status line.
    conversion?.then(() => { setCopyError(errorMessage(error)) }, () => {})
  }, [conversion])

  const choose = useCallback((target: Target) => {
    if (conversion === null || busy) return
    setCopyError(null)
    setBusy(true)
    const label = t(`target.${target}`)
    const mode = copyMode(target)
    // Clipboard writes start inside the click so a pending conversion keeps the user activation.
    if (mode === 'image') {
      copyLongImage(conversion).then(() => { onCopied(t('toast.image', { target: label })) }, fail)
    } else if (mode === 'native') {
      conversion.then(payload => copyNative(payload, target)).then((result) => {
        onCopied(target === 'feishu'
          ? t('toast.feishu')
          : result.windowsHtml ? t('toast.dingtalkWindows') : t('toast.copied', { target: label }))
      }, fail)
    } else {
      copyRich(conversion, target).then(() => { onCopied(t('toast.email')) }, fail)
    }
  }, [busy, conversion, fail, onCopied, t])

  const status = empty
    ? { text: t('status.empty'), error: true }
    : state.kind === 'converting'
      ? { text: t('status.converting'), error: false }
      : state.kind === 'failed'
        ? { text: t('status.failed', { message: state.message }), error: true }
        : busy
            ? { text: t('status.copying'), error: false }
            : {
                text: t('status.ready', {
                  images: state.payload.imageCount,
                  tables: state.payload.tableImages,
                  code: state.payload.codeImages,
                  math: state.payload.mathImages,
                  mermaid: state.payload.mermaidImages,
                  original: state.payload.originalImages,
                }),
                error: false,
              }

  return (
    <Modal open onClose={onClose} title={t('dialog.title')} closeLabel={t('dialog.close')} description={t('dialog.hint')} className="md2chat-share-dialog">
      <p className="md2chat-share-status" role="status" data-error={status.error || undefined}>{status.text}</p>
      {copyError !== null && (
        <p className="md2chat-share-status" role="alert" data-error>{t('status.copyFailed', { message: copyError })}</p>
      )}
      {state.kind === 'ready' && (
        // md2chat's preview: escaped text runs and data-URL images only, never raw Markdown HTML.
        <div className="md2chat-share-preview" dangerouslySetInnerHTML={{ __html: state.payload.preview }} />
      )}
      <div className="md2chat-share-targets">
        {TARGETS.map(target => (
          <button
            key={target}
            type="button"
            className="md2chat-share-target"
            disabled={empty || busy || state.kind === 'failed'}
            title={t(`mode.${copyMode(target)}`)}
            onClick={() => { choose(target) }}
          >
            {t(`target.${target}`)}
          </button>
        ))}
      </div>
    </Modal>
  )
}
