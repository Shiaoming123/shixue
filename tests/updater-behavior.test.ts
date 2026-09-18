import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const updaterSource = () => ts.createSourceFile(
  'updater.ts',
  readFileSync(new URL('../src/lib/updater.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)

function loadCheckForUpdates(ports: Record<string, unknown>) {
  const file = new URL('../src/lib/updater.ts', import.meta.url)
  const source = ts.createSourceFile('updater.ts', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'checkForUpdates')
  assert.ok(fn)
  const code = ts.transpileModule(fn.getText(source).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
    transformers: { before: [(context) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          return ts.factory.updateCallExpression(node, ts.factory.createIdentifier('loadModule'), node.typeArguments, node.arguments)
        }
        return ts.visitEachChild(node, visit, context)
      }
      return (root) => ts.visitNode(root, visit) as ts.SourceFile
    }] },
  }).outputText
  return new Function(...Object.keys(ports), `${code}; return checkForUpdates;`)(...Object.values(ports)) as (
    onState: (state: { phase: string; percent: number; message: string }) => void,
  ) => Promise<void>
}

test('an available update stays busy while confirmation or download startup is pending', () => {
  const source = updaterSource()
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'isUpdateBusy')
  assert.ok(fn)
  const code = ts.transpileModule(fn.getText(source).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const isUpdateBusy = new Function(`${code}; return isUpdateBusy;`)() as (phase: string) => boolean

  for (const phase of ['checking', 'update-available', 'downloading', 'installing'] as const) {
    assert.equal(isUpdateBusy(phase), true)
  }
  for (const phase of ['idle', 'unconfigured', 'up-to-date', 'error'] as const) {
    assert.equal(isUpdateBusy(phase), false)
  }
})

test('manual update check exposes an up-to-date result without opening a confirmation', async () => {
  const states: Array<{ phase: string; percent: number; message: string }> = []
  const checkForUpdates = loadCheckForUpdates({
    isUpdaterConfiguredForBuild: () => true,
    IDLE_UPDATE_STATE: { phase: 'idle', percent: 0, message: '' },
    loadModule: async (name: string) => {
      if (name.includes('dialog')) return { ask: async () => assert.fail('no update must not ask') }
      if (name.includes('process')) return { relaunch: async () => assert.fail('no update must not relaunch') }
      return { check: async () => null }
    },
  })

  await checkForUpdates((state) => states.push(state))

  assert.deepEqual(states.map(({ phase }) => phase), ['checking', 'up-to-date'])
  assert.equal(states.at(-1)?.message, '已经是最新版本')
})

test('manual update check exposes the available release before downloading and installing it', async () => {
  const states: Array<{ phase: string; percent: number; message: string }> = []
  let relaunched = false
  const checkForUpdates = loadCheckForUpdates({
    isUpdaterConfiguredForBuild: () => true,
    IDLE_UPDATE_STATE: { phase: 'idle', percent: 0, message: '' },
    loadModule: async (name: string) => {
      if (name.includes('dialog')) return { ask: async () => true }
      if (name.includes('process')) return { relaunch: async () => { relaunched = true } }
      return {
        check: async () => ({
          version: '0.4.0', body: 'notes',
          downloadAndInstall: async (onEvent: (event: unknown) => void) => {
            onEvent({ event: 'Started', data: { contentLength: 10 } })
            onEvent({ event: 'Progress', data: { chunkLength: 10 } })
            onEvent({ event: 'Finished', data: {} })
          },
        }),
      }
    },
  })

  await checkForUpdates((state) => states.push(state))

  assert.deepEqual(states.map(({ phase }) => phase), [
    'checking', 'update-available', 'downloading', 'downloading', 'installing',
  ])
  assert.equal(states[1].message, '发现新版本 0.4.0')
  assert.equal(relaunched, true)
})

test('manual update check keeps a visible error result', async () => {
  const states: Array<{ phase: string; percent: number; message: string }> = []
  const checkForUpdates = loadCheckForUpdates({
    isUpdaterConfiguredForBuild: () => true,
    IDLE_UPDATE_STATE: { phase: 'idle', percent: 0, message: '' },
    loadModule: async () => { throw new Error('network unavailable') },
  })

  await checkForUpdates((state) => states.push(state))

  assert.deepEqual(states.map(({ phase }) => phase), ['checking', 'error'])
  assert.match(states[1].message, /network unavailable/)
})
