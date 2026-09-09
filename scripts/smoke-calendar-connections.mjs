import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolveBrowserExecutable } from './smoke-web-persistence.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifacts = resolve(root, 'artifacts/visual-qa/calendar-connections')
await mkdir(artifacts, { recursive: true })
await writeFile(resolve(artifacts, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic connector smoke</title><div id="app"></div><div id="ui-overlay-host"></div><script type="module" src="./harness.ts"></script></html>')
await writeFile(resolve(artifacts, 'harness.ts'), `
import { createApp, h } from 'vue'
import Panel from '/src/components/calendar/CalendarConnectionsPanel.vue'
import { useCalendarConnections } from '/src/lib/use-calendar-connections.ts'
import { createInMemoryWorkspaceStore } from '/src/storage/study/in-memory.ts'
import { createTaskCapabilityService } from '/src/domain/capabilities/service.ts'
import { stableId } from '/src/calendar-connections/types.ts'
import { applyTheme } from '/src/assets/themes/index.ts'
import '/src/assets/themes/global.css'
applyTheme('study', false)
const store = createInMemoryWorkspaceStore()
const initial = await store.load()
const service = createTaskCapabilityService(store, () => '2026-09-09T12:00:00Z', () => crypto.randomUUID())
await service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: 'synthetic-task', expectedWorkspaceRevision: initial.revision, command: { type: 'task.create', taskId: 'synthetic-task', listId: initial.lists[0].id, title: 'Independent synthetic task' } })
const initialTasks = (await store.load()).tasks
const calls = []
let connected = false
let mode = 'freebusy'
const batch = { batchId: 'synthetic-batch', provider: 'google', connectionId: 'synthetic-connection', calendarId: 'synthetic-calendar', sourceId: stableId('google', 'synthetic-connection', 'synthetic-calendar'), mode: 'full', access: 'details', title: '合成共享日历', timezone: 'UTC', items: [{ id: 'synthetic-event', summary: '合成只读会议', start: { dateTime: '2026-09-09T08:00:00Z' }, end: { dateTime: '2026-09-09T09:00:00Z' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=synthetic' }] }
const invoke = async (command, args) => {
  calls.push({ command, args })
  const operation = command.split('|')[1]
  const status = () => ({ state: connected ? 'ready' : 'disconnected', grantedScopes: connected ? [mode] : [] })
  if (operation === 'status') return status()
  if (operation === 'connect') { connected = true; mode = args.mode; return status() }
  if (operation === 'disconnect') { connected = false; return status() }
  if (operation === 'list_calendars') return { items: [{ id: 'synthetic-calendar', summary: '合成共享日历', timeZone: 'UTC', accessRole: mode === 'details' ? 'reader' : 'freeBusyReader', backgroundColor: '#668575' }] }
  if (operation === 'free_busy') return { calendars: { 'synthetic-calendar': { errors: [{ reason: 'forbidden' }] } } }
  if (operation === 'stage_events' || operation === 'read_staged') { if (mode !== 'details') throw 'SCOPE_REQUIRED'; return batch }
  if (operation === 'ack_events') {
    const receipt = (await store.load()).commandReceipts.find((value) => value.id === args.workspaceReceiptId)
    if (receipt?.commandType !== 'calendar_external.apply' || receipt.result.data.batchId !== args.batchId) throw new Error('Synthetic acknowledgement proof failed')
    return { applied: true, batchId: args.batchId }
  }
  throw new Error('Unexpected synthetic operation')
}
const controller = useCalendarConnections({ enabled: true, runtime: { platform: 'desktop', capabilities: ['native-sql'] }, config: { clientId: 'synthetic-client', connectionId: 'synthetic-connection' }, store, invoke, refreshWorkspace: async () => {} })
window.__connectorSmoke = { calls, initialTasks, snapshot: () => store.load() }
createApp({ setup: () => () => h('main', { style: { maxWidth: '680px', margin: '0 auto', padding: '16px' } }, [h(Panel, { controller })]) }).mount('#app')
`)
await build({ configFile: false, root, base: './', plugins: [vue()], logLevel: 'warn', build: { target: 'esnext', outDir: resolve(artifacts, 'dist'), emptyOutDir: false, rollupOptions: { input: resolve(artifacts, 'index.html') } } })
const server = await preview({ configFile: false, root, logLevel: 'warn', build: { outDir: resolve(artifacts, 'dist') }, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const { chromium } = await import('playwright-core')
const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true })
const consoleErrors = []; const pageErrors = []; const externalRequests = []
try {
  const context = await browser.newContext({ viewport: { width: 820, height: 900 }, reducedMotion: 'reduce' })
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') { externalRequests.push(url.origin); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const address = server.httpServer.address()
  await page.goto('http://127.0.0.1:' + address.port + '/artifacts/visual-qa/calendar-connections/index.html', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '检查连接', exact: true }).click()
  await page.getByText('尚未连接', { exact: true }).waitFor()
  assert.match(await page.getByRole('button', { name: '读取范围', exact: true }).innerText(), /仅忙闲/)
  await page.getByRole('button', { name: '在浏览器中连接 Google', exact: true }).click()
  await page.getByText('仅忙闲', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__connectorSmoke.calls.find((call) => call.command.endsWith('|connect')).args.mode), 'freebusy')
  await page.getByRole('button', { name: '查询未来7天忙闲', exact: true }).click()
  await page.getByText('部分忙闲结果未知，不能据此判断空闲。', { exact: true }).waitFor()
  assert.match(await page.locator('article').innerText(), /忙闲未知/)
  assert.equal(await page.evaluate(async () => (await window.__connectorSmoke.snapshot()).calendarEvents.length), 0)
  await page.getByRole('button', { name: '断开连接并保留缓存', exact: true }).click()
  await page.getByText('尚未连接', { exact: true }).waitFor()
  await page.getByRole('button', { name: '读取范围', exact: true }).click()
  await page.getByRole('option', { name: '会议详情与忙闲（只读）', exact: true }).click()
  await page.getByRole('button', { name: '在浏览器中连接 Google', exact: true }).click()
  await page.getByRole('button', { name: '同步日程', exact: true }).click()
  await page.getByText('日历已同步。', { exact: true }).waitFor()
  const snapshot = await page.evaluate(async () => ({ state: await window.__connectorSmoke.snapshot(), initialTasks: window.__connectorSmoke.initialTasks, calls: window.__connectorSmoke.calls }))
  assert.deepEqual(snapshot.state.tasks, snapshot.initialTasks)
  assert.equal(snapshot.state.calendarEvents.length, 1)
  assert.equal(snapshot.state.calendarEvents[0].title, '合成只读会议')
  assert.equal(snapshot.state.calendarSources.find((source) => source.provider === 'google').permission, 'read')
  assert.deepEqual(snapshot.calls.filter((call) => call.command.endsWith('|connect')).map((call) => call.args.mode), ['freebusy', 'details'])
  await page.getByRole('button', { name: '查询未来7天忙闲', exact: true }).click()
  await page.getByText('部分忙闲结果未知，不能据此判断空闲。', { exact: true }).waitFor()
  for (const width of [820, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(() => [...document.querySelectorAll('button,[role="checkbox"]')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.width && (rect.left < -1 || rect.right > innerWidth + 1) }).map((element) => element.textContent))
    assert.deepEqual(overflow, [], 'Visible controls must fit the viewport at ' + width)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal document overflow')
    await page.screenshot({ path: resolve(artifacts, 'connector-' + width + '.png'), fullPage: true })
  }
  await page.getByRole('button', { name: '断开连接并保留缓存', exact: true }).click()
  await page.getByText('已断开，保留已缓存的日程。', { exact: true }).waitFor()
  const disconnected = await page.evaluate(async () => await window.__connectorSmoke.snapshot())
  assert.deepEqual(disconnected.calendarEvents, snapshot.state.calendarEvents)
  assert.deepEqual(disconnected.tasks, snapshot.initialTasks)
  assert.deepEqual(consoleErrors, []); assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, [])
  const summary = { viewports: [820, 320], syntheticNative: true, externalRequests: 0, events: 1, tasksUnchanged: true, retainedAfterDisconnect: true, consoleErrors: 0, pageErrors: 0 }
  await writeFile(resolve(artifacts, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
} finally { await browser.close(); await new Promise((resolveClose) => server.httpServer.close(resolveClose)) }
