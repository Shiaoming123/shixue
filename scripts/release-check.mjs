import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { inspectReleaseConfig } from './release-kit/config.mjs'
import { runNpmCommand } from './release-kit/npm-command.mjs'

export const REQUIRED_RELEASE_SUITES = [
  { id: 'migration-state', files: ['tests/workspace-migration.test.ts', 'tests/workspace-state-v3.test.ts'] },
  { id: 'capability-service', files: ['tests/capability-service.test.ts'] },
  { id: 'review-links', files: ['tests/review-task-link.test.ts', 'tests/migrated-review-completion.test.ts', 'tests/recurrence-learning-completion.test.ts'] },
  { id: 'workspace-navigation', files: ['tests/workspace-navigation.test.ts', 'tests/web-navigation.test.ts'] },
  { id: 'workspace-projections', files: ['tests/workspace-projections.test.ts', 'tests/study-task-query.test.ts'] },
  { id: 'recurrence', files: ['tests/recurrence-calculate.test.ts', 'tests/recurrence-commands.test.ts', 'tests/recurrence-materialize.test.ts', 'tests/recurrence-projection.test.ts', 'tests/recurrence-schedule-contract.test.ts'] },
  { id: 'quick-add', files: ['tests/quick-add-parser.test.ts', 'tests/quick-add-composer-state.test.ts', 'tests/quick-add-shortcut.test.ts', 'tests/quick-add-ui-contract.test.ts', 'tests/quick-add-shortcut-lifecycle.browser.test.mjs'] },
  { id: 'reminders', files: ['tests/reminder-authority.test.ts', 'tests/reminder-rules.test.ts', 'tests/reminder-runtime.test.ts', 'tests/reminder-ui-contract.test.ts', 'tests/study-reminders.test.ts'] },
  { id: 'calendar', files: ['tests/calendar-command-handler.test.ts', 'tests/calendar-commands.test.ts', 'tests/calendar-layout.test.ts', 'tests/calendar-projection.test.ts', 'tests/calendar-responsive.test.ts', 'tests/calendar-ui-contract.test.ts'] },
  { id: 'shared-shell', files: ['tests/ui-control-contract.test.ts', 'tests/responsive-shell.test.ts', 'tests/task-detail-layout.test.ts', 'tests/business-sheet-mount.test.ts', 'tests/modal-overlay-lifecycle.test.ts', 'tests/overlay-host-contract.test.ts', 'tests/popover-mobile-sheet-contract.test.ts'] },
]

export const REQUIRED_RELEASE_COMMANDS = [
  { id: 'check-protocol', command: ['run', 'check:protocol'] },
  { id: 'check-csp', command: ['run', 'check:csp'] },
  { id: 'check-modules-desktop', command: ['run', 'check:modules'] },
  { id: 'check-modules-web', command: ['run', 'check:modules', '--', 'web'] },
  { id: 'check-modules-mobile', command: ['run', 'check:modules', '--', 'mobile'] },
  { id: 'typecheck', command: ['run', 'typecheck'] },
  { id: 'build-desktop', command: ['run', 'build'] },
  { id: 'build-web', command: ['run', 'build:web'] },
  { id: 'check-layout', command: ['run', 'check:layout'] },
  { id: 'check-docs', command: ['run', 'check:docs'] },
]

export function parseNodeTestSummary(output) {
  const readCount = (label) => Number(output.match(new RegExp(`^\\s*# ${label} (\\d+)\\s*$`, 'm'))?.[1] ?? Number.NaN)
  const summary = { pass: readCount('pass'), fail: readCount('fail'), skipped: readCount('skipped') }
  return Object.values(summary).every(Number.isInteger) ? summary : null
}

export function validateReleaseGateResults(suiteInventory, commandInventory, results) {
  const errors = []
  const expectedFiles = suiteInventory.flatMap((suite) => suite.files)
  const actualFiles = results.suites.map((result) => result.file)
  if (new Set(expectedFiles).size !== expectedFiles.length || new Set(actualFiles).size !== actualFiles.length
    || expectedFiles.length !== actualFiles.length || !expectedFiles.every((file) => actualFiles.includes(file))) {
    errors.push('Release suite results must report every required test file exactly once.')
  }
  for (const result of results.suites) {
    if (result.status !== 'PASS') errors.push(`Release suite ${result.file} is ${result.status}.`)
    if (result.fail > 0) errors.push(`Release suite ${result.file} reported ${result.fail} failed tests.`)
    if (result.skipped > 0) errors.push(`Release suite ${result.file} reported ${result.skipped} skipped tests.`)
    if (!Number.isInteger(result.pass) || result.pass < 1) errors.push(`Release suite ${result.file} did not report a passing test.`)
  }
  const expectedCommands = commandInventory.map((entry) => entry.id)
  const actualCommands = results.commands.map((entry) => entry.id)
  if (new Set(expectedCommands).size !== expectedCommands.length || new Set(actualCommands).size !== actualCommands.length
    || expectedCommands.length !== actualCommands.length || !expectedCommands.every((id) => actualCommands.includes(id))) {
    errors.push('Release command results must report every required command exactly once.')
  }
  for (const result of results.commands) {
    if (result.status !== 'PASS') errors.push(`Release command ${result.id} is ${result.status}.`)
  }
  return errors
}

export function runReleaseGateInventory(root, {
  suiteInventory = REQUIRED_RELEASE_SUITES,
  commandInventory = REQUIRED_RELEASE_COMMANDS,
  runTest = (file) => spawnSync(process.execPath, [
    '--experimental-strip-types', '--test', '--test-reporter=tap', resolve(root, file),
  ], { cwd: root, encoding: 'utf8', windowsHide: true }),
  runCommand = (command) => runNpmCommand(command, { spawnOptions: { cwd: root, encoding: 'utf8' } }),
} = {}) {
  const suites = suiteInventory.flatMap((suite) => suite.files.map((file) => {
    if (!existsSync(resolve(root, file))) return { suite: suite.id, file, status: 'MISSING', pass: 0, fail: 0, skipped: 0 }
    const execution = runTest(file)
    const summary = parseNodeTestSummary(`${execution.stdout ?? ''}\n${execution.stderr ?? ''}`)
    if (!summary) return { suite: suite.id, file, status: execution.status === null ? 'NOT_RUN' : 'FAIL', pass: 0, fail: 0, skipped: 0 }
    const status = execution.status === 0 && summary.fail === 0 && summary.skipped === 0 && summary.pass > 0 ? 'PASS' : 'FAIL'
    return { suite: suite.id, file, status, ...summary }
  }))
  const commands = commandInventory.map(({ id, command }) => {
    const execution = runCommand(command)
    return { id, command: `npm ${command.join(' ')}`, status: execution.status === 0 ? 'PASS' : execution.status === null ? 'NOT_RUN' : 'FAIL' }
  })
  const summary = {
    files: suites.length,
    pass: suites.reduce((count, result) => count + result.pass, 0),
    fail: suites.reduce((count, result) => count + result.fail, 0),
    skipped: suites.reduce((count, result) => count + result.skipped, 0),
  }
  const results = { suites, commands, summary }
  return { ...results, errors: validateReleaseGateResults(suiteInventory, commandInventory, results) }
}

function parseMode(args) {
  let mode = 'template'
  let modeWasProvided = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument !== '--mode' && !argument.startsWith('--mode=')) continue
    const value = argument === '--mode' ? args[index += 1] : argument.slice('--mode='.length)
    if (value !== 'template' && value !== 'release') {
      throw new TypeError(`Unknown release check mode: ${value ?? '(missing)'}. Expected template or release.`)
    }
    if (modeWasProvided) throw new TypeError('Release check mode may be provided only once.')
    mode = value
    modeWasProvided = true
  }
  return mode
}

async function main() {
  let mode
  try {
    mode = parseMode(process.argv.slice(2))
  } catch (error) {
    console.error(`ERROR ${error.message}`)
    process.exitCode = 1
    return
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const config = await inspectReleaseConfig(root, mode)
  for (const line of config.summary) console.log(line)
  for (const warning of config.warnings) console.log(`WARN ${warning}`)
  for (const error of config.errors) console.error(`ERROR ${error}`)
  if (mode !== 'release') {
    if (config.errors.length > 0) process.exitCode = 1
    return
  }

  const gates = runReleaseGateInventory(root)
  const report = {
    schemaVersion: 1,
    version: JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version,
    generatedAt: new Date().toISOString(),
    mode,
    configuration: { status: config.errors.length === 0 ? 'PASS' : 'FAIL', errors: config.errors },
    ...gates,
  }
  const reportDirectory = resolve(root, 'src-tauri', 'target')
  mkdirSync(reportDirectory, { recursive: true })
  const reportPath = resolve(reportDirectory, 'release-check-report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Release gate report: ${reportPath}`)
  console.log(`Release suite totals: files=${gates.summary.files} pass=${gates.summary.pass} fail=${gates.summary.fail} skipped=${gates.summary.skipped}`)
  for (const error of gates.errors) console.error(`ERROR ${error}`)
  if (config.errors.length > 0 || gates.errors.length > 0) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
