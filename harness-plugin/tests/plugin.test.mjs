import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { replyMarkdown } from '../src/client/reply.ts'

const snapshot = nodes => ({ nodes: { values: () => nodes } })
const tail = (messageId, blocks) => ({ kind: 'turn-tail', data: { closing: { blocks, finalNode: { messageId } } } })

test('reply Markdown joins only the matching turn closing text blocks', () => {
  const nodes = [
    { kind: 'assistant', data: {} },
    tail('m1', [{ kind: 'text', text: '旧回复' }]),
    tail('m2', [{ kind: 'text', text: '## 标题\n\n' }, { kind: 'image', attachment: {} }, { kind: 'text', text: '| a |\n|---|\n| 1 |' }]),
  ]
  assert.equal(replyMarkdown(snapshot(nodes), 'm2'), '## 标题\n\n| a |\n|---|\n| 1 |')
  assert.equal(replyMarkdown(snapshot(nodes), 'm1'), '旧回复')
})

test('unknown messages, interrupted turns and missing snapshots yield empty Markdown', () => {
  assert.equal(replyMarkdown(snapshot([tail('m1', [{ kind: 'text', text: 'x' }])]), 'other'), '')
  assert.equal(replyMarkdown(snapshot([{ kind: 'turn-tail', data: { closing: null } }]), 'm1'), '')
  assert.equal(replyMarkdown(undefined, 'm1'), '')
})

test('client bundle uses the Harness module-loader handoff and only shell-provided externals', () => {
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /^window\.__ModuleLoader__\.load\(\{ id: "md2chat-dsh-share", factory: \(require\) => \{/)
  assert.match(bundle.trimEnd(), /return module\.exports; \} \}\);$/)
  const externals = new Set([...bundle.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]))
  assert.deepEqual([...externals].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'])
})

test('host half serves the lazily loaded vendor files and the native copy route', async () => {
  const { COPY_ROUTE, VENDOR_FILES, VENDOR_ROUTE, apply, inject } = await import('../index.js')
  assert.deepEqual(inject, ['connection'])
  const routes = []
  apply({ effect: fn => fn(), connection: { fetch: { register: route => { routes.push(route); return async () => {} } } } })
  assert.deepEqual(routes.map(route => route.path), [...VENDOR_FILES.map(file => VENDOR_ROUTE + file), COPY_ROUTE])
  const response = await routes.find(route => route.path.endsWith('highlight.min.js')).fetch(new Request('http://x/'))
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.match(await response.text(), /hljs/)
  const renderers = readFileSync(new URL('../../assets/renderers.js', import.meta.url), 'utf8')
  for (const file of VENDOR_FILES) assert(renderers.includes(`'${file}'`), file)
  const copy = routes.at(-1)
  assert.deepEqual(copy.methods, ['POST'])
  const rejected = await copy.fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ target: 'wechat', parts: [] }) }))
  assert.equal(rejected.status, 400)
})

test('native writer receives the request on stdin and surfaces its result or error', async () => {
  const { writeNative } = await import('../index.js')
  const dir = mkdtempSync(join(tmpdir(), 'md2chat-share-'))
  const fake = join(dir, 'writer')
  writeFileSync(fake, '#!/bin/sh\nread body\ncase "$body" in *fail*) echo "写入失败" >&2; exit 1;; esac\necho "{\\"images\\":1,\\"args\\":\\"$1 $2 $3\\"}"\n', { mode: 0o755 })
  assert.deepEqual(await writeNative({ target: 'feishu', parts: [] }, { binary: fake, cacheDir: '/tmp/c' }), { images: 1, args: 'copy --cache-dir /tmp/c' })
  await assert.rejects(writeNative({ target: 'fail' }, { binary: fake, cacheDir: '/tmp/c' }), /写入失败/)
  await assert.rejects(writeNative({}, { binary: join(dir, 'missing'), cacheDir: '/tmp/c' }), /npm run build/)
})

test('cached PNGs live in the platform cache directory', async () => {
  const { imageCacheDir } = await import('../index.js')
  assert.equal(imageCacheDir('darwin', {}, '/Users/u'), '/Users/u/Library/Caches/md2chat-dsh-share/clipboard-images')
  assert.equal(imageCacheDir('linux', { XDG_CACHE_HOME: '/c' }, '/home/u'), '/c/md2chat-dsh-share/clipboard-images')
})
