import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return }
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:18476').pathname)
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`)
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return }
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    response.writeHead(404).end('Not found')
  }
})
server.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
server.listen(18476, '127.0.0.1', () => console.log('拾学 Soft Surface: http://127.0.0.1:18476 — Ctrl+C 停止'))
