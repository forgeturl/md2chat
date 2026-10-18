/** Write lib/dev.cordis.yml: a --patch overlay inserting this checkout by absolute path (the Loader requires one). */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../index.js', import.meta.url))
const target = new URL('../lib/dev.cordis.yml', import.meta.url)
mkdirSync(new URL('../lib/', import.meta.url), { recursive: true })
writeFileSync(target, `- insert:\n    - id: md2chat-share\n      name: '${entry.replaceAll("'", "''")}'\n`)
console.log(fileURLToPath(target))
