/**
 * Assistant Markdown → md2chat payload → system clipboard. Reuses md2chat's
 * browser core unchanged (bundled through each file's CommonJS branch); this
 * module only supplies the Harness-side image loader, vendor URL, and the
 * per-target copy mode:
 * - WeChat / WeCom: one long image (their chat inputs lose mixed text+image layout);
 * - DingTalk / Feishu: md2chat desktop's native formats, written by the Host half;
 * - Email: md2chat's standard HTML with editable tables.
 */
import markdown from 'md2chat-core/chat-markdown.js'
import ChatPayload, { type Payload } from 'md2chat-core/chat-payload.js'
import renderers from 'md2chat-core/renderers.js'
import TableImages from 'md2chat-core/table-images.js'
import ChatTargets, { type Target } from 'md2chat-core/chat-targets.js'
import ClipboardImage from 'md2chat-core/clipboard-image.js'

export type { Payload, Target }

/** Served by the Host half (index.js VENDOR_ROUTE); renderers.js resolves vendor scripts against it. */
const VENDOR_ROUTE = '/api/md2chat-share/vendor/'
;(globalThis as { md2chatVendorBase?: string }).md2chatVendorBase = VENDOR_ROUTE

/** Host half's native writer (index.js COPY_ROUTE). */
const COPY_ROUTE = '/api/md2chat-share/copy'

export const TARGETS = ['wechat', 'wecom', 'dingtalk', 'feishu', 'email'] as const satisfies readonly Target[]

export type CopyMode = 'image' | 'native' | 'html'
export function copyMode(target: Target): CopyMode {
  if (target === 'wechat' || target === 'wecom') return 'image'
  return target === 'dingtalk' || target === 'feishu' ? 'native' : 'html'
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(reader.result as string) }
    reader.onerror = () => { reject(new Error('无法读取图片')) }
    reader.readAsDataURL(blob)
  })
}

/** Remote Markdown images become decoded data URLs, as md2chat's editor does for pasted URLs. */
async function ensureImage(asset: { src: string }) {
  let src = asset.src
  if (!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src)) {
    if (!/^https?:\/\//i.test(src)) throw new Error('暂不支持本地或相对路径图片')
    const response = await fetch(src, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) throw new Error('返回的不是图片')
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 10 MB')
    src = await blobToDataUrl(blob)
  }
  const image = new Image()
  image.src = src
  try { await image.decode() } catch { throw new Error('图片无法解码') }
  if (image.naturalWidth * image.naturalHeight > 20_000_000) throw new Error('图片不能超过 2000 万像素')
  return { src, width: image.naturalWidth, height: image.naturalHeight }
}

/**
 * Convert one reply with md2chat's pipeline.
 * @param source - the assistant reply's Markdown.
 * @returns the ordered chat payload (segments, email segments, preview HTML, counts).
 */
export function convert(source: string): Promise<Payload> {
  return ChatPayload.build(source, {
    markdown,
    renderers,
    renderTable: (header, rows) => TableImages.render(header, rows),
    ensureImage,
    describeImageError: (src, error) => (src.startsWith('data:') ? '内嵌图片' : src) + '：' + error.message,
  })
}

/**
 * Write one target's rich HTML + plain text. The payload may still be
 * converting: ClipboardItem accepts promised blobs, which keeps the click's
 * user activation alive across slow Mermaid/MathJax renders.
 * @param payload - finished or pending conversion.
 * @param target - destination chat app.
 * @returns the number of images written.
 */
export async function copyRich(payload: Promise<Payload>, target: Target): Promise<number> {
  const adapted = payload.then((p) => {
    const result = ChatTargets.render(target === 'email' ? p.emailSegments : p.segments, target)
    return { ...result, plain: p.plain }
  })
  adapted.catch(() => {})
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': adapted.then(a => new Blob([a.html], { type: 'text/html' })),
    'text/plain': adapted.then(a => new Blob([a.plain], { type: 'text/plain' })),
  })])
  return (await adapted).imageCount
}

function pngBlob(src: string): Blob {
  const bytes = atob(src.slice(src.indexOf(',') + 1))
  return new Blob([Uint8Array.from(bytes, c => c.charCodeAt(0))], { type: 'image/png' })
}

/**
 * Render the whole reply as one long image (md2chat lowers the resolution of
 * very long replies rather than splitting them) and copy it as a lone PNG.
 * The PNG is promised inside the click so slow renders keep user activation.
 * @param payload - finished or pending conversion.
 */
export async function copyLongImage(payload: Promise<Payload>): Promise<void> {
  const png = payload
    .then(p => ClipboardImage.render(p.segments, { fit: true }))
    .then(image => pngBlob(image.src))
  png.catch(() => {})
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

export interface NativeResult { images: number; native: boolean; feishuNative: boolean; windowsHtml: boolean }

/**
 * Hand the segments to the Host half, which writes md2chat desktop's native
 * DingTalk/Feishu representation (private types + cached PNG files).
 * @param payload - finished conversion.
 * @param target - 'dingtalk' or 'feishu'.
 */
export async function copyNative(payload: Payload, target: Target): Promise<NativeResult> {
  const response = await fetch(COPY_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target, parts: payload.segments }),
  })
  const body = await response.json().catch(() => null) as { ok: boolean; result?: NativeResult; error?: string } | null
  if (body?.ok !== true || body.result === undefined) throw new Error(body?.error ?? 'HTTP ' + response.status)
  return body.result
}
