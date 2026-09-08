import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { createWorkspaceExport } from '../src/storage/workspace/data-port.ts'
import { prepareWorkspaceImport, summarizeWorkspace } from '../src/lib/workspace-data-summary.ts'
import { currentSidebarDestination } from '../src/lib/sidebar-navigation.ts'
import { resolveRecurrenceEditWrite, resolveReminderEditWrite } from '../src/lib/task-edit-commit.ts'
import { learningBatchBlockers, routeSingleTaskCompletion } from '../src/lib/task-completion-routing.ts'

// Execute the production handlers with deterministic ports; no browser or source-pattern assertions.
function script(file: string) {
  const { descriptor } = parse(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'))
  return ts.createSourceFile(file, descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true)
}
function handlers(file: string, names: string[], ports: Record<string, unknown>): Record<string, (...args: any[]) => any> {
  const source = script(file)
  const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(functions.length, names.length)
  const code = ts.transpileModule(functions.map((node) => node.getText(source)).join('\n'), {
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
  return new Function(...Object.keys(ports), `${code}; return { ${names.join(',')} };`)(...Object.values(ports))
}
const ref = <T>(value: T) => ({ value })

test('review commit blocks double ratings and keeps refresh failure retries read-only', async () => {
  const reviewBusy = ref(false)
  const reviewRevealed = ref(true)
  const notices: any[][] = []
  let writes = 0
  let failRead = true
  const { rateReview, reloadReviews } = handlers('App.vue', ['rateReview', 'reloadReviews'], {
    reviewBusy, reviewRevealed, reviewRefreshRequired: ref(false), today: ref('2026-09-08'),
    completeReviewTaskLink: async () => { writes++; return { nextReviewOn: null } },
    capabilityService: { query: async () => ({ revision: 1 }), execute: async () => { writes++; return { data: { nextLinkId: null } } } },
    CAPABILITY_PROTOCOL_VERSION: 1,
    refreshState: async () => { if (failRead) throw new Error('read unavailable') },
    notify: (...args: any[]) => notices.push(args), reportStorageError: assert.fail,
  })
  await Promise.all([rateReview('review:first', 'clear'), rateReview('review:first', 'fuzzy')])
  assert.equal(writes, 1)
  assert.equal(reviewBusy.value, true, 'stale outcome controls must remain disabled after commit')
  assert.match(notices[0][0], /复习结果已保存.*刷新失败/)
  assert.equal(await reloadReviews(), false)
  assert.equal(reviewBusy.value, true)
  failRead = false
  assert.equal(await reloadReviews(), true)
  assert.equal(writes, 1)
  assert.equal(reviewBusy.value, false)
  assert.equal(reviewRevealed.value, false)
})

test('review feedback describes the persisted next cycle and releases failed writes for retry', async () => {
  for (const nextLinkId of ['review:next', null, undefined]) {
    const notices: string[] = []
    const reviewBusy = ref(false)
    let failWrite = true
    const { rateReview } = handlers('App.vue', ['rateReview', 'reloadReviews'], {
      reviewBusy, reviewRevealed: ref(true), reviewRefreshRequired: ref(false), today: ref('2026-09-08'),
      completeReviewTaskLink: async () => { if (failWrite) throw new Error('write unavailable'); return { nextReviewOn: nextLinkId ? '2026-09-15' : null } },
      capabilityService: { query: async () => ({ revision: 1 }), execute: async () => { if (failWrite) throw new Error('write unavailable'); return { data: { nextLinkId } } } },
      CAPABILITY_PROTOCOL_VERSION: 1, refreshState: async () => {},
      notify: (message: string) => notices.push(message), reportStorageError: (error: Error) => notices.push(error.message),
    })
    await rateReview('review:first', 'clear')
    assert.equal(reviewBusy.value, false)
    assert.deepEqual(notices, ['write unavailable'])
    failWrite = false
    await rateReview('review:first', 'clear')
    assert.equal(reviewBusy.value, false)
    assert.equal(notices[1], nextLinkId ? '已安排下一次回顾。' : nextLinkId === null ? '已完成这一轮复习。' : '复习结果已刷新。')
  }
})

test('learning completion closes after commit and offers a read-only retry when refreshing fails', async () => {
  const completionTaskId = ref('learning-task')
  const completionOpen = ref(true)
  const completionOccurrenceBusy = ref(false)
  const notices: any[][] = []
  let writes = 0
  let reads = 0
  const write = async (envelope: any) => {
    writes += 1
    assert.equal(envelope.expectedWorkspaceRevision, 1)
    assert.equal(envelope.command.type, 'task.complete')
    assert.equal(envelope.command.expectedRevision, 2)
    assert.equal(envelope.command.evidence, 'passing example')
  }
  const refreshState = async () => { reads += 1; throw new Error('read unavailable') }
  const { completeTaskEvidence } = handlers('App.vue', ['completeTaskEvidence'], {
    completionTaskId, completionOpen, completionOccurrenceBusy,
    recurrenceWorkspace: ref({ tasks: [{ id: 'learning-task', mode: 'learning', revision: 2 }] }),
    capabilityService: { query: async () => ({ revision: 1 }), execute: write }, CAPABILITY_PROTOCOL_VERSION: 1,
    refreshState, notify: (...args: any[]) => notices.push(args),
  })
  const payload = { learned: 'why it works', evidence: 'passing example', nextAction: 'apply it', mastery: 3 }
  await Promise.all([completeTaskEvidence(payload), completeTaskEvidence(payload)])
  assert.equal(writes, 1, 'repeated submission must not write twice')
  assert.equal(completionOpen.value, false, 'committed evidence must not remain editable for retry')
  assert.equal(completionTaskId.value, '')
  assert.equal(completionOccurrenceBusy.value, false)
  assert.match(notices[0][0], /学习证据已保存.*刷新失败/)
  await assert.rejects(notices[0][1].run(), /read unavailable/)
  assert.equal(writes, 1, 'retry must only reload the committed result')
  assert.equal(reads, 2)
})

test('failed learning completion retains its evidence context for retry', async () => {
  const completionTaskId = ref('learning-task')
  const completionOpen = ref(true)
  const completionOccurrenceBusy = ref(false)
  const fail = async () => { throw new Error('write unavailable') }
  const notices: string[] = []
  const { completeTaskEvidence } = handlers('App.vue', ['completeTaskEvidence'], {
    completionTaskId, completionOpen, completionOccurrenceBusy,
    recurrenceWorkspace: ref({ tasks: [{ id: 'learning-task', mode: 'learning', revision: 2 }] }),
    capabilityService: { query: async () => ({ revision: 1 }), execute: fail }, CAPABILITY_PROTOCOL_VERSION: 1,
    refreshState: () => assert.fail('failed writes must not refresh'),
    notify: (message: string) => notices.push(message),
  })
  await completeTaskEvidence({ learned: 'draft', evidence: 'proof', nextAction: 'next', mastery: 3 })
  assert.equal(completionOpen.value, true)
  assert.equal(completionTaskId.value, 'learning-task')
  assert.equal(completionOccurrenceBusy.value, false)
  assert.deepEqual(notices, ['write unavailable'])
})

test('workspace refresh keeps an unsaved focus note visible so continued typing cannot erase it', async () => {
  const state = ref({ sessions: [{ id: 'focus', scratchpad: 'new note' }] })
  const api = handlers('App.vue', ['refreshState'], {
    getWorkspaceStore: () => ({ load: async () => ({}) }),
    projectWorkspaceState: () => ({ sessions: [{ id: 'focus', scratchpad: 'old note' }] }),
    recurrenceWorkspace: ref({}), state, scheduleCloudSync: () => {},
    scratchNotes: new Map([['focus', 'new note']]), refreshVersion: 0, appliedRefreshVersion: 0,
  })
  await api.refreshState()
  assert.equal(state.value.sessions[0].scratchpad, 'new note')
})

test('a delayed workspace read cannot erase a note committed while the read was pending', async () => {
  const scratchDrafts = new Map([['focus', 'new note']])
  const scratchNotes = new Map(scratchDrafts)
  const state = ref({ sessions: [{ id: 'focus', scratchpad: 'new note' }] })
  const api = handlers('App.vue', ['refreshState'], {
    getWorkspaceStore: () => ({ load: async () => { scratchDrafts.clear(); return {} } }),
    projectWorkspaceState: () => ({ sessions: [{ id: 'focus', scratchpad: 'old note' }] }),
    recurrenceWorkspace: ref({}), state, scheduleCloudSync: () => {}, scratchDrafts, scratchNotes, refreshVersion: 0, appliedRefreshVersion: 0,
  })
  await api.refreshState()
  assert.equal(state.value.sessions[0].scratchpad, 'new note')
})

test('an older refresh cannot overwrite a newer read after that read confirms the saved note', async () => {
  const scratchNotes = new Map([['focus', 'new note']])
  const state = ref({ sessions: [{ id: 'focus', scratchpad: 'new note' }] })
  let resolveOld!: (value: unknown) => void
  const oldRead = new Promise((resolve) => { resolveOld = resolve })
  let reads = 0
  const api = handlers('App.vue', ['refreshState'], {
    getWorkspaceStore: () => ({ load: () => ++reads === 1 ? oldRead : Promise.resolve('new note') }),
    projectWorkspaceState: (note: string) => ({ sessions: [{ id: 'focus', scratchpad: note }] }),
    recurrenceWorkspace: ref({}), state, scheduleCloudSync: () => {}, scratchNotes, refreshVersion: 0, appliedRefreshVersion: 0,
  })
  const oldRefresh = api.refreshState()
  await api.refreshState()
  assert.equal(scratchNotes.size, 0)
  resolveOld('old note')
  await oldRefresh
  assert.equal(state.value.sessions[0].scratchpad, 'new note')
})

test('an older successful refresh still applies when the newer request fails', async () => {
  const state = ref({ sessions: [{ id: 'focus', scratchpad: 'stale note' }] })
  let resolveOld!: (value: string) => void
  const oldRead = new Promise<string>((resolve) => { resolveOld = resolve })
  let reads = 0
  const api = handlers('App.vue', ['refreshState'], {
    getWorkspaceStore: () => ({ load: () => ++reads === 1 ? oldRead : Promise.reject(new Error('read failed')) }),
    projectWorkspaceState: (note: string) => ({ sessions: [{ id: 'focus', scratchpad: note }] }),
    recurrenceWorkspace: ref({}), state, scheduleCloudSync: () => {},
    scratchNotes: new Map(), refreshVersion: 0, appliedRefreshVersion: 0,
  })
  const oldRefresh = api.refreshState()
  await assert.rejects(api.refreshState(), /read failed/)
  resolveOld('saved note')
  await oldRefresh
  assert.equal(state.value.sessions[0].scratchpad, 'saved note')
})

test('a permanently failed session does not starve later notes and offers an explicit retry', async () => {
  const scratchDrafts = new Map([['broken', 'failed note'], ['working', 'good note']])
  const writes: string[] = []
  const actions: { label: string; run: () => Promise<void> }[] = []
  let fail = true
  const api = handlers('App.vue', ['saveScratchDrafts'], {
    scratchDrafts, scratchSaving: false, reportStorageError: () => {},
    notify: (_message: string, action: { label: string; run: () => Promise<void> }) => actions.push(action),
    saveStudyScratchpad: async (id: string) => {
      writes.push(id)
      if (id === 'broken' && fail) throw new Error('session gone')
    },
  })
  await api.saveScratchDrafts()
  assert.deepEqual(writes, ['broken', 'working'])
  assert.deepEqual([...scratchDrafts.keys()], ['broken'])
  assert.equal(actions[0]?.label, '重试')
  fail = false
  await actions[0]!.run()
  assert.equal(scratchDrafts.size, 0)
})

test('saving notes drains newer typing in order and saves both tasks after a quick switch', async () => {
  const scratchDrafts = new Map([['first', 'first draft'], ['second', 'second draft']])
  const writes: string[] = []
  const api = handlers('App.vue', ['saveScratchDrafts'], {
    scratchDrafts, scratchSaving: false, reportStorageError: (error: unknown) => { throw error },
    saveStudyScratchpad: async (id: string, value: string) => {
      writes.push(`${id}:${value}`)
      if (value === 'first draft') scratchDrafts.set(id, 'newer draft')
    },
  })
  await api.saveScratchDrafts()
  assert.deepEqual(writes, ['first:first draft', 'second:second draft', 'first:newer draft'])
  assert.deepEqual([...scratchDrafts], [])
})

test('failed note writes retain the draft for refresh and retry', async () => {
  const scratchDrafts = new Map([['focus', 'unsaved note']])
  const errors: unknown[] = []
  const api = handlers('App.vue', ['saveScratchDrafts'], {
    scratchDrafts, scratchSaving: false, notify: () => {}, reportStorageError: (error: unknown) => errors.push(error),
    saveStudyScratchpad: async () => { throw new Error('disk unavailable') },
  })
  await api.saveScratchDrafts()
  assert.equal(scratchDrafts.get('focus'), 'unsaved note')
  assert.equal(errors.length, 1)
})

test('typing starts persistence immediately without waiting for a debounce timer', () => {
  let writes = 0
  const scratchDrafts = new Map<string, string>()
  const api = handlers('App.vue', ['updateScratchpad'], {
    activeSession: ref({ id: 'focus', scratchpad: '' }), scratchDrafts, scratchNotes: new Map(),
    saveScratchDrafts: async () => { writes++ },
  })
  api.updateScratchpad('last input before reload')
  assert.equal(writes, 1)
  assert.equal(scratchDrafts.get('focus'), 'last input before reload')
})

test('pending note writes serialize and merge fast typing until the final commit completes', async () => {
  const scratchDrafts = new Map([['focus', 'first']])
  const writes: string[] = []
  let finish!: () => void
  const committed = new Promise<void>((resolve) => { finish = resolve })
  const api = handlers('App.vue', ['saveScratchDrafts'], {
    scratchDrafts, scratchSaving: false, reportStorageError: (error: unknown) => { throw error },
    saveStudyScratchpad: async (_id: string, value: string) => {
      writes.push(value)
      if (value === 'first') await committed
    },
  })
  const saving = api.saveScratchDrafts()
  scratchDrafts.set('focus', 'middle')
  await api.saveScratchDrafts()
  scratchDrafts.set('focus', 'last')
  await api.saveScratchDrafts()
  assert.deepEqual(writes, ['first'])
  assert.equal(scratchDrafts.get('focus'), 'last')
  finish()
  await saving
  assert.deepEqual(writes, ['first', 'last'])
  assert.equal(scratchDrafts.size, 0)
})

test('a failed immediate save can be retried without losing the latest draft', async () => {
  const scratchDrafts = new Map([['focus', 'retry this']])
  let fail = true
  const api = handlers('App.vue', ['saveScratchDrafts'], {
    scratchDrafts, scratchSaving: false, notify: () => {}, reportStorageError: () => {},
    saveStudyScratchpad: async () => { if (fail) throw new Error('disk unavailable') },
  })
  await api.saveScratchDrafts()
  assert.equal(scratchDrafts.size, 1)
  fail = false
  await api.saveScratchDrafts()
  assert.equal(scratchDrafts.size, 0)
})

test('only the current destination owns selection even when previous filters remain', () => {
  assert.equal(currentSidebarDestination('settings', 'today', 'list:a'), 'page:settings')
  assert.equal(currentSidebarDestination('review', 'all', 'list:a'), 'page:review')
  assert.equal(currentSidebarDestination('topics', 'inbox', 'list:a'), 'page:topics')
  assert.equal(currentSidebarDestination('tasks', 'all', 'list:a'), 'list:list:a')
  assert.equal(currentSidebarDestination('tasks', 'next7'), 'smart:next7')
  assert.equal(currentSidebarDestination('today', 'all', 'list:a'), 'smart:today')
})

test('quick add refreshes and selects a learning task with an actionable criteria hint', async () => {
  const selectedTaskId = ref('')
  const selectedOccurrenceId = ref('stale')
  const messages: string[] = []
  const recurrenceWorkspace = ref({ tasks: [{ id: 'learning', mode: 'learning' }] })
  const api = handlers('App.vue', ['quickAddCreated'], {
    refreshState: async () => {}, selectedTaskId, selectedOccurrenceId, recurrenceWorkspace,
    activeSmartView: ref('inbox'), notify: (message: string) => messages.push(message),
  })
  await api.quickAddCreated({ type: 'task', id: 'learning', revision: 1 })
  assert.equal(selectedTaskId.value, 'learning')
  assert.equal(selectedOccurrenceId.value, '')
  assert.deepEqual(messages, ['学习任务已加入收件箱；可在编辑任务中补充完成标准。'])
})

test('summary validates the whole candidate without writing and counts records that replacement would remove', async () => {
  const store = createInMemoryWorkspaceStore()
  const current = await store.load()
  const content = JSON.stringify(createWorkspaceExport(current, '2026-09-05T00:00:00.000Z'))
  const preview = prepareWorkspaceImport(content)
  assert.equal(preview.content, content)
  assert.equal(preview.exportedAt, '2026-09-05T00:00:00.000Z')
  assert.equal(preview.summary, `${current.tasks.length} 项任务 · ${current.lists.length} 个清单 · ${current.completionRecords.length} 条完成证据`)
  assert.deepEqual(await store.load(), current)
  assert.throws(() => prepareWorkspaceImport('{broken'))
  const invalid = JSON.parse(content)
  invalid.state.tasks[0].listId = 'missing-list'
  assert.throws(() => prepareWorkspaceImport(JSON.stringify(invalid)))
  assert.equal(summarizeWorkspace({ ...current, tasks: [], lists: [], completionRecords: [] }), '0 项任务 · 0 个清单 · 0 条完成证据')
})

test('failed import keeps the verified candidate for retry and duplicate confirmation cannot execute', async () => {
  const current = await createInMemoryWorkspaceStore().load()
  const candidate = prepareWorkspaceImport(JSON.stringify(createWorkspaceExport(current)))
  const importPreview = ref<typeof candidate | null>(candidate)
  const importError = ref('')
  const importFileName = ref('backup.json')
  const dataBusy = ref(false)
  const importOpen = ref(true)
  const calls: Array<[string, string, (ok: boolean) => void]> = []
  const api = handlers('components/study/SettingsView.vue', ['confirmImport', 'clearImport'], {
    props: { workspace: current }, importPreview, importError, importFileName, dataBusy, importOpen,
    importInput: ref(null), emit: (...args: any[]) => calls.push(args as [string, string, (ok: boolean) => void]),
  })
  api.confirmImport()
  api.confirmImport()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], candidate.content)
  calls[0][2](false)
  assert.equal(importPreview.value, candidate)
  assert.equal(importOpen.value, true)
  assert.match(importError.value, /可重试/)
  assert.equal(dataBusy.value, false)
  api.confirmImport()
  calls[1][2](true)
  assert.equal(importPreview.value, null)
  assert.equal(importFileName.value, '')
  assert.equal(importOpen.value, false)
})

test('cancel and invalid file selection do not request a destructive command', async () => {
  const importPreview = ref(null)
  const importError = ref('')
  let emitted = 0
  const api = handlers('components/study/SettingsView.vue', ['selectImport', 'clearImport'], {
    importPreview, importError, importFileName: ref(''), dataBusy: ref(false), importOpen: ref(false), confirmReset: ref(false), importInput: ref(null),
    prepareWorkspaceImport, emit: () => emitted++,
  })
  await api.selectImport({ target: { files: [{ name: 'bad.json', text: async () => '{broken' }] } })
  assert.equal(importPreview.value, null)
  assert.notEqual(importError.value, '')
  api.clearImport()
  assert.equal(emitted, 0)
})

test('reset stays reviewable after failure and acknowledges completion only after successful persistence', () => {
  const confirmReset = ref(true)
  const dataBusy = ref(false)
  const resetError = ref('')
  const callbacks: Array<(ok: boolean) => void> = []
  const api = handlers('components/study/SettingsView.vue', ['resetDemo'], {
    props: { workspace: {} }, confirmReset, dataBusy, resetError,
    emit: (_event: string, done: (ok: boolean) => void) => callbacks.push(done),
  })
  api.resetDemo()
  api.resetDemo()
  assert.equal(callbacks.length, 1)
  assert.equal(confirmReset.value, true)
  callbacks[0](false)
  assert.equal(confirmReset.value, true)
  assert.match(resetError.value, /重试/)
  api.resetDemo()
  callbacks[1](true)
  assert.equal(confirmReset.value, false)
  assert.equal(dataBusy.value, false)
})

test('App reports import failure to the review dialog instead of clearing its candidate', async () => {
  let refreshed = 0
  const errors: unknown[] = []
  const results: boolean[] = []
  const api = handlers('App.vue', ['importData'], {
    importStudyState: async () => { throw Error('disk full') }, refreshState: async () => refreshed++,
    selectedTaskId: ref('selected'), notify() { assert.fail('failed writes cannot be announced as success') },
    reportStorageError: (error: unknown) => errors.push(error),
  })
  await api.importData('candidate', (ok: boolean) => results.push(ok))
  assert.equal(refreshed, 0)
  assert.equal(errors.length, 1)
  assert.deepEqual(results, [false])
})

test('App downloads separate restorable JSON and readable Markdown exports', async () => {
  const downloads: unknown[][] = []
  const messages: string[] = []
  const api = handlers('App.vue', ['exportJsonData', 'exportMarkdownData'], {
    exportStudyState: async () => '{"format":"meow-study/workspace-export"}',
    exportLearningRecordsMarkdown: async () => '# 拾学学习记录\n',
    downloadData: (...args: unknown[]) => downloads.push(args),
    today: ref('2026-09-07'),
    notify: (message: string) => messages.push(message),
    reportStorageError(error: unknown) { assert.fail(String(error)) },
  })

  await api.exportJsonData()
  await api.exportMarkdownData()

  assert.deepEqual(downloads, [
    ['{"format":"meow-study/workspace-export"}', 'application/json', '拾学记录-2026-09-07.json'],
    ['# 拾学学习记录\n', 'text/markdown;charset=utf-8', '拾学学习记录-2026-09-07.md'],
  ])
  assert.deepEqual(messages, ['JSON 备份已导出。', 'Markdown 学习记录已导出。'])
})

test('sidebar failure keeps selection and never reports restoration success', () => {
  const messages: string[] = []
  const original = { displayMode: 'icons', order: ['b', 'a'] }
  const sidebarPreferences = ref(original)
  let fails = true
  const api = handlers('App.vue', ['updateSidebarPreferences', 'resetSidebarOrder'], {
    sidebarPreferences, sidebarMenuKeys: ref(['a', 'b']), notify: (message: string) => messages.push(message),
    saveSidebarPreferences: (value: unknown) => { if (fails) throw Error('quota'); return value },
  })
  api.resetSidebarOrder()
  assert.equal(sidebarPreferences.value, original)
  assert.deepEqual(messages, ['侧边栏设置未能保存，请重试。'])
  fails = false
  api.resetSidebarOrder()
  assert.deepEqual(sidebarPreferences.value.order, ['a', 'b'])
  assert.equal(messages.at(-1), '已恢复默认菜单顺序。')
})

test('appearance persistence failure leaves the displayed and selected theme unchanged', () => {
  const appearanceDark = ref(false)
  let applied = 0
  const messages: string[] = []
  const api = handlers('App.vue', ['setAppearance'], {
    appearanceDark, applyTheme: () => applied++, localStorage: { setItem() { throw Error('quota') } }, notify: (message: string) => messages.push(message),
  })
  api.setAppearance('dark')
  assert.equal(appearanceDark.value, false)
  assert.equal(applied, 0)
  assert.equal(messages.length, 1)
})

test('refresh projects both UI models from the same newly loaded workspace', async () => {
  const next = await createInMemoryWorkspaceStore().load()
  const state = ref<unknown>('old')
  const recurrenceWorkspace = ref<unknown>('old')
  const projected = { tasks: ['new'], sessions: [] }
  let reads = 0
  const api = handlers('App.vue', ['refreshState'], {
    state, recurrenceWorkspace, scratchNotes: new Map(), refreshVersion: 0, appliedRefreshVersion: 0, scheduleCloudSync() {},
    getWorkspaceStore: () => ({ load: async () => { reads++; return next } }),
    projectWorkspaceState: (value: unknown) => { assert.equal(value, next); return projected },
  })
  await api.refreshState()
  assert.equal(reads, 1)
  assert.equal(recurrenceWorkspace.value, next)
  assert.equal(state.value, projected)
})

test('successful cloud download uses the shared refresh before announcing sync success', async () => {
  const cloudStatus = ref('signed-in')
  const cloudMessage = ref('')
  let refreshed = 0
  const api = handlers('App.vue', ['syncStudyCloud'], {
    cloudConfig: {}, cloudStatus, cloudMessage, cloudEmail: ref('test@example.invalid'), localDeviceId: () => 'test-device',
    getWorkspaceStore: () => ({}), cloudAdapter: async () => ({}),
    loadModule: async () => ({ createStudyCloudSyncController: () => ({ syncOnce: async () => ({ state: 'success', action: 'downloaded' }) }) }),
    refreshState: async () => { assert.equal(cloudStatus.value, 'syncing'); refreshed++ },
    loadStudyState() { assert.fail('cloud download must refresh all workspace projections') },
  })
  await api.syncStudyCloud()
  assert.equal(refreshed, 1)
  assert.equal(cloudStatus.value, 'signed-in')
  assert.equal(cloudMessage.value, '已接收较新的云端记录。')
})

test('denied preference access does not prevent workspace initialization', async () => {
  const source = script('App.vue')
  const registration = source.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'onMounted') as ts.ExpressionStatement
  const callback = (registration.expression as ts.CallExpression).arguments[0]
  const js = ts.transpileModule(`const mounted = ${callback.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const loading = ref(true)
  let loaded = 0
  const messages: string[] = []
  const ports = {
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    handleQuickAdd() {}, handleModuleError() {}, handleGlobalSearchShortcut() {}, appearanceDark: ref(false), remindersEnabled: ref(false),
    localStorage: { getItem() { throw Error('SecurityError') } }, notify: (message: string) => messages.push(message),
    applyTheme() {}, applyReducedGlass() {}, planningPreferences: ref({ reducedGlassOverride: 'system' }),
    compactMedia: undefined, compact: ref(false), onCompactChange() {},
    refreshState: async () => { loaded++ }, state: ref({ topics: [] }), selectedTopicId: ref(''), showFocus: ref(false), activeSession: ref(null),
    reportSmokePhase: async () => {}, runNativeAndroidPersistenceSmoke: async () => null, capabilityService: {},
    reportStorageError() { assert.fail('preference failure must not become a domain-storage failure') }, loading,
    cloudAvailable: false, runtime: { platform: 'web' }, initializeDeviceCapabilities: async () => {}, initializeReminders: async () => {}, clockTimer: undefined, reminderTimer: undefined, cloudTimer: undefined, setInterval: () => 0,
    disposed: false,
  }
  await new Function(...Object.keys(ports), `${js}; return mounted();`)(...Object.values(ports))
  assert.equal(loaded, 1)
  assert.equal(loading.value, false)
  assert.match(messages[0], /偏好暂时无法读取/)
})

test('unmount during native initialization cannot install timers after teardown', async () => {
  const source = script('App.vue')
  const registration = source.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'onMounted') as ts.ExpressionStatement
  const callback = (registration.expression as ts.CallExpression).arguments[0]
  const js = ts.transpileModule(`const mounted = ${callback.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const ports = {
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    handleQuickAdd() {}, handleModuleError() {}, handleGlobalSearchShortcut() {}, appearanceDark: ref(false), remindersEnabled: ref(false),
    localStorage: { getItem: () => null }, notify() {}, applyTheme() {}, applyReducedGlass() {}, planningPreferences: ref({ reducedGlassOverride: 'system' }),
    compactMedia: undefined, compact: ref(false), onCompactChange() {}, refreshState: async () => {}, state: ref({ topics: [] }), selectedTopicId: ref(''), showFocus: ref(false), activeSession: ref(null),
    reportSmokePhase: async () => {}, runNativeAndroidPersistenceSmoke: async () => null, capabilityService: {},
    reportStorageError(error: unknown) { throw error }, loading: ref(true), cloudAvailable: false, runtime: { platform: 'desktop' },
  }
  const result = await new Function(...Object.keys(ports), `
    let disposed = false, reminderInitializations = 0, timers = 0
    let clockTimer, reminderTimer, cloudTimer
    const initializeDeviceCapabilities = async () => { disposed = true }
    const initializeReminders = async () => { reminderInitializations++ }
    const setInterval = () => { timers++; return 1 }
    ${js}
    return mounted().then(() => ({ reminderInitializations, timers }))
  `)(...Object.values(ports))
  assert.deepEqual(result, { reminderInitializations: 1, timers: 0 })
})

test('failed reminder preference write cannot turn the visible switch on', async () => {
  const remindersEnabled = ref(false)
  const reminderMessage = ref('')
  const api = handlers('App.vue', ['setReminders'], {
    remindersEnabled, reminderMessage, reminderSettingBusy: ref(false), nativeNotificationAvailable: ref(false), notificationPermission: ref('unavailable'),
    localStorage: { setItem() { throw Error('quota') } },
  })
  await api.setReminders(true)
  assert.equal(remindersEnabled.value, false)
  assert.match(reminderMessage.value, /未能保存/)
})

test('failed native autostart write leaves the visible switch at the confirmed system state', async () => {
  const autostartEnabled = ref(false)
  const autostartBusy = ref(false)
  const deviceMessage = ref('')
  const api = handlers('App.vue', ['setLaunchAtLogin'], {
    autostartAvailable: ref(true), autostartEnabled, autostartBusy, deviceMessage,
    loadModule: async () => ({ setAutostartEnabled: async () => { throw Error('plugin denied') } }),
  })

  await api.setLaunchAtLogin(true)
  assert.equal(autostartEnabled.value, false)
  assert.equal(autostartBusy.value, false)
  assert.match(deviceMessage.value, /plugin denied/)
})

test('ordinary task edits omit the compatibility reminder field so independently edited rules survive', async () => {
  let update: Record<string, unknown> | undefined
  const original = { title: 'Stored', notes: '', topicId: null, plannedOn: null, dueOn: null, reminderAt: null, priority: 'none', estimateMinutes: null }
  const api = handlers('App.vue', ['saveTaskEdit'], {
    selectedTask: ref({ id: 'task', revision: 3 }), updateStudyTask: async (_id: string, value: Record<string, unknown>) => { update = value },
    readCurrentTaskEdit: async () => ({ task: { id: 'task', revision: 3 }, value: original }), resolveTaskEditWrite: () => 'write',
    refreshState: async () => {}, taskEditorOpen: ref(true), reminderBusy: ref(false), reminderError: ref(''), recurrenceScopeOpen: ref(false),
    runTaskEditCommit: async (input: any, steps: any) => { await steps.saveTask(); for (const reminder of input.reminders) await steps.saveReminder(reminder); if (input.recurrence) await steps.saveRecurrence(input.recurrence) },
    reminderCommandForCurrentState: () => null, saveReminderRuleWithoutBusyGuard: async () => {}, requestRecurrenceEdit: async () => {},
    notify() {}, reportStorageError(error: unknown) { throw error },
  })
  await api.saveTaskEdit({ ...original, title: 'Updated' }, { baseTask: original, reminderCommands: [] })
  assert.equal(update?.title, 'Updated')
  assert.equal(Object.hasOwn(update!, 'reminderAt'), false)
})

test('task edit retry skips an already saved task and resumes only the failed nested write', async () => {
  const original = { title: 'Stored', notes: '', topicId: null, plannedOn: '2026-09-06', dueOn: null, reminderAt: null, priority: 'none', estimateMinutes: 15, acceptanceCriteria: [] }
  const desired = { ...original, title: 'Updated' }
  let current = original
  let revision = 3
  let taskSaves = 0
  let reminderAttempts = 0
  const errors: unknown[] = []
  const api = handlers('App.vue', ['saveTaskEdit'], {
    selectedTask: ref({ id: 'task', revision }), reminderBusy: ref(false), reminderError: ref(''), recurrenceScopeOpen: ref(false), taskEditorOpen: ref(true),
    readCurrentTaskEdit: async () => ({ task: { id: 'task', revision }, value: current }),
    resolveTaskEditWrite: (value: any, base: any, target: any) => JSON.stringify(value) === JSON.stringify(target) ? 'noop' : JSON.stringify(value) === JSON.stringify(base) ? 'write' : 'conflict',
    updateStudyTask: async () => { taskSaves++; revision++; current = desired }, refreshState: async () => {},
    runTaskEditCommit: async (input: any, steps: any) => { await steps.saveTask(); for (const reminder of input.reminders) await steps.saveReminder(reminder) },
    reminderCommandForCurrentState: (value: any) => value,
    saveReminderRuleWithoutBusyGuard: async () => { reminderAttempts++; if (reminderAttempts === 1) throw Error('reminder CAS') },
    requestRecurrenceEdit: async () => {}, notify() {}, reportStorageError: (error: unknown) => errors.push(error),
  })
  const changes = { baseTask: original, reminderCommands: [{ type: 'reminder.set', ruleId: 'r', taskId: 'task', occurrenceId: null, trigger: { kind: 'at_start' }, enabled: true }] }
  await api.saveTaskEdit(desired, changes)
  await api.saveTaskEdit(desired, changes)
  assert.equal(taskSaves, 1, 'retry must not create a second task revision after the first task save succeeded')
  assert.equal(reminderAttempts, 2, 'retry resumes the failed reminder')
  assert.equal(errors.length, 1)
})

test('reminder edit uses its opened base for update, remove, add, convergence, and concurrent conflict', async () => {
  const base = { id: 'rule', taskId: 'task', occurrenceId: null, trigger: { kind: 'at_start' }, enabled: true, revision: 1 }
  let rules: any[] = [{ ...base, revision: 3 }]
  const api = handlers('App.vue', ['reminderCommandForCurrentState'], {
    getWorkspaceStore: () => ({ load: async () => ({ reminderRules: rules }) }), resolveReminderEditWrite,
  })
  const update = { type: 'reminder.set', ruleId: 'rule', taskId: 'task', occurrenceId: null, trigger: { kind: 'before_start', minutes: 10 }, enabled: true }
  assert.equal((await api.reminderCommandForCurrentState(update, [base])).expectedRevision, 3)
  const remove = { ...update, trigger: base.trigger, enabled: false }
  assert.equal((await api.reminderCommandForCurrentState(remove, [base])).expectedRevision, 3)
  rules = []
  const addition = { ...update, ruleId: 'new' }
  assert.equal(Object.hasOwn(await api.reminderCommandForCurrentState(addition, []), 'expectedRevision'), false)
  rules = [{ id: 'rule', taskId: 'task', occurrenceId: null, trigger: update.trigger, enabled: true, revision: 1 }]
  assert.equal(await api.reminderCommandForCurrentState(update, [base]), null, 'an independently converged desired rule is complete')
  rules = [{ ...base, trigger: { kind: 'before_start', minutes: 60 }, revision: 4 }]
  await assert.rejects(() => api.reminderCommandForCurrentState(update, [base]), /其他位置|冲突/)
})

test('recurrence create retry detects persisted convergence and never executes or opens update scope twice', async () => {
  const rule = { cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', end: { kind: 'never' } }
  const task = { id: 'task', revision: 2, recurrenceSeriesId: null, schedule: { startAt: null, startOn: '2026-09-06' } }
  let persistedSeries: any = null
  let executes = 0
  let refreshes = 0
  const recurrenceScopeOpen = ref(false)
  const taskEditorOpen = ref(true)
  const selectedRecurrence = ref<any>(null)
  const api = handlers('App.vue', ['requestRecurrenceEdit'], {
    selectedRecurrence, selectedTask: ref({ id: 'task', plannedOn: '2026-09-06' }), recurrenceWorkspace: ref({ revision: 7, tasks: [task] }),
    recurrenceExecuting: ref(false), recurrenceScopeOpen, taskEditorOpen, pendingRecurrenceRule: null,
    clearRecurrencePreview() {}, cloneRecurrenceRuleDto: (value: any) => structuredClone(value),
    getWorkspaceStore: () => ({ load: async () => ({ revision: persistedSeries ? 8 : 7, tasks: [{ ...task, revision: persistedSeries ? 3 : 2, recurrenceSeriesId: persistedSeries?.id ?? null }], recurrenceSeries: persistedSeries ? [persistedSeries] : [] }) }),
    resolveRecurrenceEditWrite,
    capabilityService: { execute: async () => { executes++; persistedSeries = { id: 'series', taskId: 'task', revision: 1, ...structuredClone(rule), timezone: 'Asia/Shanghai', anchorAt: null, anchorOn: '2026-09-06' } } },
    CAPABILITY_PROTOCOL_VERSION: 1, crypto: { randomUUID: () => `id:${executes}` }, timezone: 'Asia/Shanghai', today: ref('2026-09-06'),
    refreshState: async () => { refreshes++; if (refreshes === 1) throw Error('refresh failed') }, notify() {},
  })
  await assert.rejects(() => api.requestRecurrenceEdit(rule, null), /refresh failed/)
  selectedRecurrence.value = persistedSeries
  await api.requestRecurrenceEdit(rule, null)
  assert.equal(executes, 1)
  assert.equal(recurrenceScopeOpen.value, false)
  assert.equal(taskEditorOpen.value, false)
})

test('recurrence create execution failure preserves the dirty editor and never opens series scope', async () => {
  const rule = { cadence: { kind: 'daily', interval: 1 }, basis: 'fixed_schedule', end: { kind: 'never' } }
  const taskEditorOpen = ref(true)
  const recurrenceScopeOpen = ref(false)
  const recurrenceExecuting = ref(false)
  const api = handlers('App.vue', ['requestRecurrenceEdit'], {
    selectedTask: ref({ id: 'task', plannedOn: null }), recurrenceExecuting, recurrenceScopeOpen, taskEditorOpen, pendingRecurrenceRule: null,
    clearRecurrencePreview() {}, cloneRecurrenceRuleDto: (value: any) => structuredClone(value),
    getWorkspaceStore: () => ({ load: async () => ({ revision: 7, tasks: [{ id: 'task', revision: 2, deletedAt: null, recurrenceSeriesId: null, schedule: { startAt: null, startOn: null } }], recurrenceSeries: [] }) }),
    resolveRecurrenceEditWrite, capabilityService: { execute: async () => { throw Error('create CAS') } },
    CAPABILITY_PROTOCOL_VERSION: 1, crypto: { randomUUID: () => 'id' }, timezone: 'Asia/Shanghai', today: ref('2026-09-06'),
    refreshState: async () => assert.fail('an execution failure cannot refresh or acknowledge the create'), notify: () => assert.fail('an execution failure cannot report success'),
  })
  await assert.rejects(() => api.requestRecurrenceEdit(rule, null), /create CAS/)
  assert.equal(taskEditorOpen.value, true)
  assert.equal(recurrenceScopeOpen.value, false)
  assert.equal(recurrenceExecuting.value, false)
})

test('recurrence three-way resolution only updates the captured base', () => {
  const base = { cadence: { kind: 'weekly', interval: 1, weekdays: [5, 1] }, basis: 'fixed_schedule', end: { kind: 'never' } }
  const desired = { ...base, cadence: { kind: 'weekly', interval: 2, weekdays: [1, 5] } }
  assert.equal(resolveRecurrenceEditWrite(base as any, base as any, desired as any), 'write')
  assert.equal(resolveRecurrenceEditWrite(desired as any, base as any, desired as any), 'noop')
  assert.equal(resolveRecurrenceEditWrite({ ...base, basis: 'after_completion' } as any, base as any, desired as any), 'conflict')
})

test('task edit fails loud when editable task state changed externally', async () => {
  const original = { title: 'Stored', notes: '', topicId: null, plannedOn: '2026-09-06', dueOn: null, reminderAt: null, priority: 'none', estimateMinutes: 15, acceptanceCriteria: [] }
  const errors: unknown[] = []
  let taskSaves = 0
  const api = handlers('App.vue', ['saveTaskEdit'], {
    selectedTask: ref({ id: 'task', revision: 4 }), reminderBusy: ref(false), reminderError: ref(''), recurrenceScopeOpen: ref(false), taskEditorOpen: ref(true),
    readCurrentTaskEdit: async () => ({ task: { id: 'task', revision: 4 }, value: { ...original, title: 'External edit' } }), resolveTaskEditWrite: () => 'conflict',
    updateStudyTask: async () => { taskSaves++ }, refreshState: async () => {},
    runTaskEditCommit: async (_input: any, steps: any) => steps.saveTask(), reminderCommandForCurrentState: () => null,
    saveReminderRuleWithoutBusyGuard: async () => {}, requestRecurrenceEdit: async () => {}, notify() {}, reportStorageError: (error: unknown) => errors.push(error),
  })
  await api.saveTaskEdit({ ...original, title: 'My draft' }, { baseTask: original, reminderCommands: [] })
  assert.equal(taskSaves, 0)
  assert.match(String(errors[0]), /其他位置|冲突/)
})

test('successful recurrence scope commit closes the dirty editor while failure keeps it open', async () => {
  const preview = { accepted: true, confirmation: 'none' }
  const envelope = { command: { scope: 'future' } }
  for (const fails of [false, true]) {
    const taskEditorOpen = ref(true)
    const recurrenceScopeOpen = ref(true)
    const errors: unknown[] = []
    const api = handlers('App.vue', ['executeRecurrenceScope', 'clearRecurrencePreview'], {
      recurrencePreview: ref(preview), recurrencePreviewEnvelope: envelope, recurrenceExecuting: ref(false), recurrenceScopeOpen, taskEditorOpen,
      recurrencePreviewVersion: 0, pendingRecurrenceRule: {}, capabilityService: { execute: async () => { if (fails) throw Error('recurrence CAS') } },
      refreshState: async () => {}, notify() {}, reportStorageError: (error: unknown) => errors.push(error),
    })
    await api.executeRecurrenceScope('future')
    assert.equal(taskEditorOpen.value, fails, fails ? 'failure keeps the dirty editor open' : 'success closes the committed editor')
    assert.equal(recurrenceScopeOpen.value, fails)
    assert.equal(errors.length, fails ? 1 : 0)
  }
})

test('learning reminder completion opens evidence entry without completing either task or occurrence', async () => {
  const completionOpen = ref(false)
  const completionReminderId = ref('')
  const reminderCenterOpen = ref(true)
  const workspace = { reminderDeliveries: [{ id: 'delivery', reminderRuleId: 'rule', occurrenceId: 'occurrence' }], reminderRules: [{ id: 'rule', taskId: 'task' }], tasks: [{ id: 'task', mode: 'learning' }] }
  const api = handlers('App.vue', ['handleReminderAction'], {
    reminderBusy: ref(false), recurrenceWorkspace: ref(workspace), reminderError: ref(''), completionOpen, completionReminderId, completionOccurrenceId: ref('stale-occurrence'), completionTaskId: ref('stale-task'), completionReviewLinkId: ref('stale-review'), reminderCenterOpen, nextTick: async () => {},
    executeReminderCommand: async () => assert.fail('no completion before evidence'),
  })
  await api.handleReminderAction({ deliveryId: 'delivery', action: 'complete' })
  assert.equal(completionOpen.value, true)
  assert.equal(completionReminderId.value, 'delivery')
  assert.equal(reminderCenterOpen.value, false)
})

test('general recurring reminder completes exactly its occurrence, and snooze changes only delivery time', async () => {
  const commands: any[] = []
  const workspace = { reminderDeliveries: [{ id: 'delivery', reminderRuleId: 'rule', occurrenceId: 'occurrence' }], reminderRules: [{ id: 'rule', taskId: 'task' }], tasks: [{ id: 'task', mode: 'general' }], occurrences: [{ id: 'occurrence', revision: 2 }] }
  const before = structuredClone(workspace)
  const api = handlers('App.vue', ['handleReminderAction'], {
    reminderBusy: ref(false), recurrenceWorkspace: ref(workspace), reminderError: ref(''),
    executeReminderCommand: async (command: unknown) => { commands.push(command) }, pollReminders: async () => {}, today: ref('2026-09-06'),
  })
  await api.handleReminderAction({ deliveryId: 'delivery', action: 'complete' })
  assert.deepEqual(commands[0], { type: 'recurrence.complete', occurrenceId: 'occurrence', expectedOccurrenceRevision: 2, reviewedOn: '2026-09-06' })
  const now = Date.now()
  await api.handleReminderAction({ deliveryId: 'delivery', action: 'snooze', minutes: 10 })
  assert.equal(commands[1].type, 'reminder.snooze')
  assert.equal(commands[1].deliveryId, 'delivery')
  assert.ok(Date.parse(commands[1].until) >= now + 600_000)
  assert.deepEqual(workspace, before)
})

test('learning occurrence completion from task surfaces opens evidence entry without executing', async () => {
  const commands: any[] = []
  const completionOpen = ref(false)
  const completionOccurrenceId = ref('')
  const workspace = {
    revision: 9,
    occurrences: [{ id: 'occurrence', seriesId: 'series', revision: 4 }],
    recurrenceSeries: [{ id: 'series', taskId: 'task' }],
    tasks: [{ id: 'task', mode: 'learning', revision: 7 }],
  }
  const api = handlers('App.vue', ['executeOccurrence'], {
    recurrenceWorkspace: ref(workspace), completionOccurrenceId, completionOpen, completionReminderId: ref('delivery'), completionTaskId: ref('stale-task'), completionReviewLinkId: ref('review'), nextTick: async () => {},
    today: ref('2026-09-06'), crypto: { randomUUID: () => 'command-id' },
    CAPABILITY_PROTOCOL_VERSION: 1,
    capabilityService: { execute: async (envelope: unknown) => { commands.push(envelope) } },
    refreshState: async () => {}, notify() {}, reportStorageError(error: unknown) { throw error },
  })
  await api.executeOccurrence('occurrence', 'recurrence.complete')
  assert.deepEqual(commands, [])
  assert.equal(completionOccurrenceId.value, 'occurrence')
  assert.equal(completionOpen.value, true)
})

test('task completion handler opens evidence for planned learning without toggling persistence', async () => {
  const completionOpen = ref(false)
  const completionTaskId = ref('')
  const workspace = { tasks: [{ id: 'learning', title: 'Learn', mode: 'learning', status: 'planned' }], reviewTaskLinks: [] }
  const api = handlers('App.vue', ['toggleTaskCompletion'], {
    state: ref({ tasks: [{ ...workspace.tasks[0], deletedAt: null }] }), recurrenceWorkspace: ref(workspace),
    routeSingleTaskCompletion, completionOpen, completionTaskId, completionReminderId: ref('stale'),
    completionOccurrenceId: ref('stale'), completionReviewLinkId: ref('stale'), nextTick: async () => {},
    openTaskAction: () => assert.fail('planned learning must not open a task action'),
    taskPrimary: async () => assert.fail('planned learning must not unblock'), notify() {},
    toggleStudyTaskCompletion: async () => assert.fail('learning completion must not use generic toggle persistence'),
  })
  await api.toggleTaskCompletion('learning')
  assert.equal(completionTaskId.value, 'learning')
  assert.equal(completionOpen.value, true)
})

test('task completion handler routes inbox and blocked learning to actionable prerequisites', async () => {
  const actions: string[] = []
  const primaries: string[] = []
  const tasks = [
    { id: 'inbox', title: 'Inbox', mode: 'learning', status: 'inbox', deletedAt: null },
    { id: 'blocked', title: 'Blocked', mode: 'learning', status: 'blocked', deletedAt: null },
  ]
  const api = handlers('App.vue', ['toggleTaskCompletion'], {
    state: ref({ tasks }), recurrenceWorkspace: ref({ tasks, reviewTaskLinks: [] }), routeSingleTaskCompletion,
    completionOpen: ref(false), completionTaskId: ref(''), completionReminderId: ref(''),
    completionOccurrenceId: ref(''), completionReviewLinkId: ref(''), nextTick: async () => {},
    openTaskAction: (id: string, mode: string) => actions.push(`${id}:${mode}`),
    taskPrimary: async (id: string) => { primaries.push(id) }, notify() {},
    toggleStudyTaskCompletion: async () => assert.fail('prerequisite routing must not toggle persistence'),
  })
  await api.toggleTaskCompletion('inbox')
  await api.toggleTaskCompletion('blocked')
  assert.deepEqual(actions, ['inbox:plan'])
  assert.deepEqual(primaries, ['blocked'])
})

test('mixed bulk completion rejects before calling any persistence port', async () => {
  const tasks = [
    { id: 'general', title: 'General', mode: 'general', status: 'planned' },
    { id: 'learning', title: 'Learning', mode: 'learning', status: 'planned' },
  ]
  const notices: string[] = []
  const api = handlers('App.vue', ['bulkCompleteTasks'], {
    recurrenceWorkspace: ref({ tasks, reviewTaskLinks: [] }), learningBatchBlockers,
    loadStudyState: async () => assert.fail('mixed batch must reject before loading for a write'),
    toggleStudyTaskCompletion: async () => assert.fail('mixed batch must reject before persistence'),
    refreshState: async () => assert.fail('rejected batch must not refresh'), selectedTaskId: ref('selected'),
    notify: (message: string) => notices.push(message), reportStorageError: (error: unknown) => { throw error },
    crypto: { randomUUID: () => 'event' }, today: ref('2026-09-08'),
  })
  await api.bulkCompleteTasks(['general', 'learning'])
  assert.deepEqual(notices, ['批量完成未执行：1 项学习任务需要逐项填写完成证据。'])
})

test('general occurrence completion from task surfaces remains a direct command', async () => {
  const commands: any[] = []
  const workspace = {
    revision: 9,
    occurrences: [{ id: 'occurrence', seriesId: 'series', revision: 4 }],
    recurrenceSeries: [{ id: 'series', taskId: 'task' }],
    tasks: [{ id: 'task', mode: 'general', revision: 7 }],
  }
  const api = handlers('App.vue', ['executeOccurrence'], {
    recurrenceWorkspace: ref(workspace), completionOccurrenceId: ref(''), completionOpen: ref(false), completionReminderId: ref(''), completionReviewLinkId: ref(''), nextTick: async () => {},
    today: ref('2026-09-06'), crypto: { randomUUID: () => 'command-id' }, CAPABILITY_PROTOCOL_VERSION: 1,
    capabilityService: { execute: async (envelope: unknown) => { commands.push(envelope) } },
    refreshState: async () => {}, notify() {}, reportStorageError(error: unknown) { throw error },
  })
  await api.executeOccurrence('occurrence', 'recurrence.complete')
  assert.deepEqual(commands[0].command, { type: 'recurrence.complete', occurrenceId: 'occurrence', expectedOccurrenceRevision: 4, reviewedOn: '2026-09-06' })
})

test('task-surface learning completion writes evidence with occurrence and task revisions', async () => {
  const envelopes: any[] = []
  const completionOpen = ref(true)
  const completionOccurrenceId = ref('occurrence')
  const completionOccurrenceBusy = ref(false)
  const workspace = {
    revision: 9,
    occurrences: [{ id: 'occurrence', seriesId: 'series', revision: 4 }],
    recurrenceSeries: [{ id: 'series', taskId: 'task' }],
    tasks: [{ id: 'task', mode: 'learning', revision: 7 }],
  }
  const api = handlers('App.vue', ['completeOccurrenceEvidence'], {
    recurrenceWorkspace: ref(workspace), completionOccurrenceId, completionOccurrenceBusy, completionOpen,
    today: ref('2026-09-06'), crypto: { randomUUID: () => 'command-id' }, CAPABILITY_PROTOCOL_VERSION: 1,
    capabilityService: { query: async () => workspace, execute: async (envelope: unknown) => { envelopes.push(envelope) } },
    refreshState: async () => {}, notify() {},
  })
  const payload = { learned: 'learned', evidence: 'proof', blocker: '', nextAction: 'next', mastery: 4 }
  await api.completeOccurrenceEvidence(payload)
  assert.deepEqual(envelopes[0], {
    protocolVersion: 1,
    idempotencyKey: 'recurrence:command-id',
    source: 'human-ui',
    expectedWorkspaceRevision: 9,
    command: { type: 'recurrence.complete', occurrenceId: 'occurrence', expectedOccurrenceRevision: 4, expectedTaskRevision: 7, ...payload, reviewedOn: '2026-09-06' },
  })
  assert.equal(completionOpen.value, false)
  assert.equal(completionOccurrenceId.value, '')
  assert.equal(completionOccurrenceBusy.value, false)
})

test('failed task-surface learning completion keeps evidence context open for retry', async () => {
  const completionOpen = ref(true)
  const completionOccurrenceId = ref('occurrence')
  const completionOccurrenceBusy = ref(false)
  const messages: string[] = []
  const workspace = {
    revision: 9,
    occurrences: [{ id: 'occurrence', seriesId: 'series', revision: 4 }],
    recurrenceSeries: [{ id: 'series', taskId: 'task' }],
    tasks: [{ id: 'task', mode: 'learning', revision: 7 }],
  }
  const api = handlers('App.vue', ['completeOccurrenceEvidence'], {
    recurrenceWorkspace: ref(workspace), completionOccurrenceId, completionOccurrenceBusy, completionOpen,
    today: ref('2026-09-06'), crypto: { randomUUID: () => 'command-id' }, CAPABILITY_PROTOCOL_VERSION: 1,
    capabilityService: { query: async () => workspace, execute: async () => { throw Error('保存失败') } }, refreshState: async () => assert.fail('failed writes must not refresh'),
    notify: (message: string) => messages.push(message),
  })
  await api.completeOccurrenceEvidence({ learned: 'learned', evidence: 'proof', blocker: '', nextAction: 'next', mastery: 4 })
  assert.equal(completionOpen.value, true)
  assert.equal(completionOccurrenceId.value, 'occurrence')
  assert.equal(completionOccurrenceBusy.value, false)
  assert.deepEqual(messages, ['保存失败'])
})

test('saved task-surface learning completion closes evidence and retries only refresh', async () => {
  const completionOpen = ref(true)
  const completionOccurrenceId = ref('occurrence')
  const completionOccurrenceBusy = ref(false)
  const notices: Array<[string, any]> = []
  let refreshes = 0
  let executions = 0
  const workspace = {
    revision: 9,
    occurrences: [{ id: 'occurrence', seriesId: 'series', revision: 4 }],
    recurrenceSeries: [{ id: 'series', taskId: 'task' }],
    tasks: [{ id: 'task', mode: 'learning', revision: 7 }],
  }
  const api = handlers('App.vue', ['completeOccurrenceEvidence'], {
    recurrenceWorkspace: ref(workspace), completionOccurrenceId, completionOccurrenceBusy, completionOpen,
    today: ref('2026-09-06'), crypto: { randomUUID: () => 'command-id' }, CAPABILITY_PROTOCOL_VERSION: 1,
    capabilityService: { query: async () => workspace, execute: async () => { executions++ } },
    refreshState: async () => { refreshes++; if (refreshes === 1) throw Error('读取失败') },
    notify: (message: string, action?: unknown) => notices.push([message, action]),
  })
  await api.completeOccurrenceEvidence({ learned: 'learned', evidence: 'proof', blocker: '', nextAction: 'next', mastery: 4 })
  assert.equal(executions, 1)
  assert.equal(completionOpen.value, false)
  assert.equal(completionOccurrenceId.value, '')
  assert.match(notices[0][0], /已保存.*刷新失败.*读取失败/)
  await notices[0][1].run()
  assert.equal(refreshes, 2)
  assert.equal(executions, 1)
})

test('an in-flight learning completion cannot close a newer evidence context', async () => {
  const completionOpen = ref(true)
  const completionOccurrenceId = ref('occurrence:a')
  const completionOccurrenceBusy = ref(false)
  let releaseExecution!: () => void
  let markStarted!: () => void
  const executionStarted = new Promise<void>((resolve) => { markStarted = resolve })
  const executionGate = new Promise<void>((resolve) => { releaseExecution = resolve })
  const workspace = {
    revision: 9,
    occurrences: [{ id: 'occurrence:a', seriesId: 'series', revision: 4 }],
    recurrenceSeries: [{ id: 'series', taskId: 'task' }],
    tasks: [{ id: 'task', mode: 'learning', revision: 7 }],
  }
  const api = handlers('App.vue', ['completeOccurrenceEvidence'], {
    recurrenceWorkspace: ref(workspace), completionOccurrenceId, completionOccurrenceBusy, completionOpen,
    today: ref('2026-09-06'), crypto: { randomUUID: () => 'command-id' }, CAPABILITY_PROTOCOL_VERSION: 1,
    capabilityService: {
      query: async () => workspace,
      execute: async () => { markStarted(); await executionGate },
    },
    refreshState: async () => {}, notify() {},
  })

  const submission = api.completeOccurrenceEvidence({ learned: 'learned', evidence: 'proof', blocker: '', nextAction: 'next', mastery: 4 })
  await executionStarted
  completionOccurrenceId.value = 'occurrence:b'
  completionOpen.value = true
  releaseExecution()
  await submission

  assert.equal(completionOccurrenceId.value, 'occurrence:b')
  assert.equal(completionOpen.value, true)
  assert.equal(completionOccurrenceBusy.value, false)
})

test('repeated learning completion sends evidence with occurrence and task revisions, never closes the parent task', async () => {
  const commands: unknown[] = []
  let polled = 0
  const completionOpen = ref(true)
  const completionReminderId = ref('delivery')
  const api = handlers('App.vue', ['completeReminderEvidence'], {
    recurrenceWorkspace: ref({ reminderDeliveries: [{ id: 'delivery', occurrenceId: 'occurrence' }], occurrences: [{ id: 'occurrence', revision: 4 }] }), completionReminderId, completionOpen,
    reminderCompletionTask: ref({ id: 'task', revision: 7 }), reminderBusy: ref(false), notify() {},
    executeReminderCommand: async (command: unknown) => { commands.push(command) }, pollReminders: async () => { polled++ }, today: ref('2026-09-06'),
  })
  const payload = { learned: 'learned', evidence: 'proof', blocker: '', nextAction: 'next', mastery: 4 }
  await api.completeReminderEvidence(payload)
  assert.deepEqual(commands, [{ type: 'recurrence.complete', occurrenceId: 'occurrence', expectedOccurrenceRevision: 4, expectedTaskRevision: 7, ...payload, reviewedOn: '2026-09-06' }])
  assert.equal(polled, 1)
  assert.equal(completionOpen.value, false)
  assert.equal(completionReminderId.value, '')
})

test('failed repeated learning completion keeps the same evidence context and open Sheet for retry', async () => {
  const completionOpen = ref(true)
  const completionReminderId = ref('delivery')
  const reminderBusy = ref(false)
  const messages: string[] = []
  const api = handlers('App.vue', ['completeReminderEvidence'], {
    recurrenceWorkspace: ref({ reminderDeliveries: [{ id: 'delivery', occurrenceId: 'occurrence' }], occurrences: [{ id: 'occurrence', revision: 4 }] }), completionReminderId, completionOpen,
    reminderCompletionTask: ref({ id: 'task', revision: 7 }), reminderBusy, notify: (message: string) => messages.push(message),
    executeReminderCommand: async () => { throw Error('保存失败') }, pollReminders: async () => assert.fail('failed writes must not poll or discard evidence'), today: ref('2026-09-06'),
  })
  const payload = Object.freeze({ learned: 'learned', evidence: 'proof', blocker: '', nextAction: 'next', mastery: 4 })
  await api.completeReminderEvidence(payload)
  assert.equal(completionOpen.value, true)
  assert.equal(completionReminderId.value, 'delivery')
  assert.equal(reminderBusy.value, false)
  assert.deepEqual(messages, ['保存失败'])
  assert.equal(payload.evidence, 'proof')
})
