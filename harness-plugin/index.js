/**
 * md2chat share plugin, Host half. The browser half (lib/client.js) does the
 * conversion; this half serves md2chat's lazily loaded renderers (MathJax,
 * Mermaid, highlight.js) and writes the native DingTalk/Feishu clipboard
 * formats through lib/native/md2chat-clipboard (md2chat desktop's own Rust
 * clipboard module, see native/), all inside Connection's authentication fence.
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'md2chat-share'
export const inject = ['connection']

/** Route prefix the client points `md2chatVendorBase` at; keep in sync with src/client/convert.ts. */
export const VENDOR_ROUTE = '/api/md2chat-share/vendor/'
export const VENDOR_FILES = ['mathjax/tex-svg.js', 'mermaid/mermaid.min.js', 'highlight/highlight.min.js']
/** POST {target, parts} → the native writer's JSON result; keep in sync with src/client/convert.ts. */
export const COPY_ROUTE = '/api/md2chat-share/copy'
export const NATIVE_TARGETS = ['dingtalk', 'feishu']

const vendorDir = new URL('./lib/vendor/', import.meta.url)
export const nativeBinary = fileURLToPath(new URL(`./lib/native/md2chat-clipboard${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const COPY_TIMEOUT_MS = 30_000

/** The private formats reference cached PNGs by path, so they must outlive the copy (the writer prunes after 7 days). */
export function imageCacheDir(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') return join(home, 'Library/Caches/md2chat-dsh-share/clipboard-images')
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData/Local'), 'md2chat-dsh-share', 'clipboard-images')
  return join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'md2chat-dsh-share', 'clipboard-images')
}

/**
 * Run the native writer with the request on stdin.
 * @returns {Promise<object>} the writer's JSON result.
 */
export function writeNative(request, { binary = nativeBinary, cacheDir = imageCacheDir(), signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['copy', '--cache-dir', cacheDir], { stdio: ['pipe', 'pipe', 'pipe'], signal, timeout: COPY_TIMEOUT_MS })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      reject(new Error(error.code === 'ENOENT' ? '原生剪贴板组件未构建，请在 harness-plugin 中运行 npm run build' : error.message))
    })
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(stderr.trim() || `原生剪贴板写入失败（退出码 ${code}）`)); return }
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('原生剪贴板返回了无效结果')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(request))
  })
}

async function handleCopy(request) {
  let body
  try { body = await request.json() } catch { return Response.json({ ok: false, error: '请求不是有效 JSON' }, { status: 400 }) }
  if (!NATIVE_TARGETS.includes(body?.target) || !Array.isArray(body?.parts)) {
    return Response.json({ ok: false, error: '不支持的目标平台或内容' }, { status: 400 })
  }
  try {
    const result = await writeNative({ target: body.target, parts: body.parts }, { signal: request.signal })
    return Response.json({ ok: true, result })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export function apply(ctx) {
  for (const file of VENDOR_FILES) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: VENDOR_ROUTE + file,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => new Response(await readFile(new URL(file, vendorDir)), {
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' },
      }),
    }), `md2chat-share: ${file}`)
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: COPY_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: handleCopy,
  }), 'md2chat-share: native copy')
}
