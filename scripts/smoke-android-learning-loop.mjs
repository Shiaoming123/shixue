import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageId = 'com.shiaoming123.shixue'
const token = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)

export async function runAndroidLearningLoop({ device: serial, launch, android, outputDirectory, exercise = exerciseLearningLoop } = {}) {
  const report = { schemaVersion: 1, device: serial, packageId, launchRunId: launch?.runId, apk: launch?.apk, success: false,
    errorCoverage: 'Playwright buffered errors available at each WebView attachment plus subsequent events; not guaranteed before attachment.' }
  let device
  try {
    assert.ok(token(serial) && token(launch?.runId), 'Invalid device or launch run id.')
    assert.ok(launch.schemaVersion === 1 && launch.success === true && launch.device === serial &&
      launch.packageId === packageId && typeof launch.apk === 'string' &&
      (isAbsolute(launch.apk) || /^[A-Za-z]:\//.test(launch.apk)) && launch.apk.endsWith('.apk') &&
      typeof launch.activity === 'string' && /^com\.shiaoming123\.shixue\/[A-Za-z0-9._]+$/.test(launch.activity),
    'Launch report does not identify the requested emulator and APK.')
    android ??= (await import('playwright-core'))._android
    const devices = await android.devices()
    const matches = devices.filter((item) => item.serial() === serial)
    assert.equal(matches.length, 1, 'Exact Android serial must be available once.')
    device = matches[0]
    assert.equal((await device.shell('getprop ro.kernel.qemu')).toString().trim(), '1', 'Only an emulator is allowed.')
    assert.equal((await device.shell(`run-as ${packageId} cat cache/shixue-android-smoke-run-id`)).toString().trim(), launch.runId, 'Native launch run does not match.')
    report.result = await exercise(device, launch, outputDirectory)
    assert.ok(report.result?.recordId && report.result?.reviewTitle, 'Learning evidence is incomplete.')
    report.success = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  } finally {
    if (device) await device.close().catch(() => {})
  }
  return report
}

async function exerciseLearningLoop(device, launch, outputDirectory) {
  const marker = `原生学习验收${launch.runId.replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit))).replace(/[^a-z]/gi, '')}`
  const note = `随手记 ${marker}`
  const evidence = `模拟器作品 ${marker}`
  const nextAction = `再次解释 ${marker}`
  const errors = []
  let page
  const connect = async () => {
    const webview = await device.webView({ pkg: packageId }, { timeout: 30_000 })
    page = await webview.page()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    const [messages, pageErrors] = await Promise.all([page.consoleMessages(), page.pageErrors()])
    errors.push(...messages.filter((message) => message.type() === 'error').map((message) => message.text()),
      ...pageErrors.map((error) => error.message))
    assert.deepEqual(errors, [], 'Native WebView already emitted errors during attachment.')
    await page.locator('.loading').waitFor({ state: 'hidden' })
  }
  const screenshot = async (name) => {
    if (outputDirectory) await page.screenshot({ path: resolve(outputDirectory, `${name}.png`), fullPage: true })
  }
  const restart = async () => {
    const before = (await device.shell(`pidof -s ${packageId}`)).toString().trim()
    assert.match(before, /^\d+$/, 'App must be running before restart.')
    await device.shell(`am force-stop ${packageId}`)
    assert.equal((await device.shell(`pidof -s ${packageId}`)).toString().trim(), '', 'App process must terminate.')
    const start = (await device.shell(`am start -W -n ${launch.activity}`)).toString()
    assert.doesNotMatch(start, /(?:Error|Exception):/, 'App restart failed.')
    await connect()
    const after = (await device.shell(`pidof -s ${packageId}`)).toString().trim()
    assert.match(after, /^\d+$/)
    assert.notEqual(after, before, 'Restart must produce a new app process.')
  }
  const openRecords = async () => {
    await page.getByRole('button', { name: '学习', exact: true }).click()
    await page.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: '回顾', exact: true }).click()
    await page.getByRole('button', { name: '完成记录', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索完成记录', exact: true }).fill(marker)
    const record = page.locator('.record-main').filter({ hasText: note })
    await record.waitFor({ state: 'visible' })
    assert.equal(await record.count(), 1, 'One completion must produce exactly one record.')
    assert.ok((await record.textContent()).includes(evidence), 'Evidence text must survive.')
    const recordId = await record.getAttribute('data-record-id')
    assert.ok(recordId, 'Completion record identity is missing.')
    await record.click()
    await page.getByText(nextAction, { exact: true }).waitFor({ state: 'visible' })
    return recordId
  }
  try {
    await connect()
    await page.getByRole('button', { name: '今天', exact: true }).click()
    const composer = page.locator('.quick-add-composer')
    await composer.getByRole('textbox', { name: '新建任务', exact: true }).fill(marker)
    const learning = composer.getByRole('button', { name: '学习任务', exact: true })
    assert.equal(await learning.getAttribute('aria-pressed'), 'false')
    await learning.click()
    assert.equal(await learning.getAttribute('aria-pressed'), 'true')
    await composer.getByRole('button', { name: '添加', exact: true }).click()
    await page.getByRole('dialog', { name: '任务详情', exact: true }).getByRole('heading', { name: marker, exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '开始学习', exact: true }).click()
    await page.getByRole('textbox', { name: '随手记', exact: true }).fill(note)
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'visible' })
    await screenshot('focus-note')
    await restart()
    const scratchpad = page.getByRole('textbox', { name: '随手记', exact: true })
    await scratchpad.waitFor({ state: 'visible' })
    assert.equal(await scratchpad.inputValue(), note, 'Scratchpad must survive app-process restart.')
    await page.getByRole('button', { name: '完成并记录', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '把时间变成证据', exact: true })
    assert.equal(await sheet.getByLabel('今天真正弄懂了什么？', { exact: true }).inputValue(), note)
    await sheet.getByLabel('成果或证据在哪里？', { exact: true }).fill(evidence)
    await sheet.getByLabel('下一步具体做什么？', { exact: true }).fill(nextAction)
    await sheet.getByRole('button', { name: '保存学习记录', exact: true }).click()
    await sheet.waitFor({ state: 'hidden' })
    const recordId = await openRecords()
    await screenshot('completion-record')
    await restart()
    assert.equal(await openRecords(), recordId, 'Restart must recover the same completion record.')
    await page.getByRole('button', { name: '全局搜索', exact: true }).click()
    const search = page.getByRole('dialog', { name: '搜索学习事实', exact: true })
    const reviewTitle = `复习 · ${marker}`
    await search.getByRole('searchbox', { name: '搜索任务与完成记录', exact: true }).fill(reviewTitle)
    const review = search.locator('.result-row').filter({ hasText: reviewTitle })
    await review.waitFor({ state: 'visible' })
    assert.equal(await review.count(), 1, 'Completion must schedule exactly one review task.')
    await screenshot('scheduled-review-after-restart')
    assert.deepEqual(errors, [], 'Native WebView emitted errors.')
    return { marker, recordId, reviewTitle, scratchpadRestartConfirmed: true, completionRestartConfirmed: true, errors }
  } catch (error) {
    if (page && outputDirectory) await screenshot('failure').catch(() => {})
    throw error
  }
}

async function main() {
  const options = {}
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index]
    assert.ok(['--device', '--launch-report', '--output'].includes(name) && process.argv[index + 1], `Invalid argument: ${name}`)
    options[name] = process.argv[index + 1]
  }
  assert.ok(options['--launch-report'] && options['--output'], 'Explicit launch report and output paths are required.')
  const output = resolve(options['--output'])
  const outputDirectory = resolve(output, '..')
  await mkdir(outputDirectory, { recursive: true })
  const report = await runAndroidLearningLoop({ device: options['--device'], launch: JSON.parse(await readFile(options['--launch-report'], 'utf8')), outputDirectory })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!report.success) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
