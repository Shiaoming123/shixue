import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const script = ts.createSourceFile('App.ts', app.split('<script setup lang="ts">')[1]!.split('</script>')[0]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function action(name: string, context: Record<string, unknown>) {
  const declaration = script.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)!
  const code = ts.transpileModule(declaration.getText(script), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(context), `${code}; return ${name}`)(...Object.values(context))
}

test('opening calendar details keeps destination and routes occurrence IDs separately', () => {
  const page = { value: 'calendar' }
  const selectedTaskId = { value: '' }
  const selectedOccurrenceId = { value: 'old' }
  const showFocus = { value: true }
  const destinations: unknown[] = []
  const opened: string[] = []
  const openTask = action('openTask', { page, selectedTaskId, selectedOccurrenceId, showFocus, setDestination: (value: unknown) => destinations.push(value) })
  const open = action('openCalendarTask', { openTask, openOccurrence: (id: string) => opened.push(id) })
  open('task:one', null)
  assert.equal(selectedTaskId.value, 'task:one')
  assert.equal(selectedOccurrenceId.value, '')
  assert.equal(showFocus.value, false)
  assert.deepEqual(destinations, [])
  open('series:parent', 'occurrence:one')
  assert.deepEqual(opened, ['occurrence:one'])
  assert.equal(selectedTaskId.value, 'task:one', 'occurrence action must not be redirected to its series parent')
})

test('calendar quick capture closes details and focuses its composer without changing the date or route', () => {
  const refs = Object.fromEntries(['completionOpen', 'completionReminderId', 'completionTaskId', 'taskActionOpen', 'taskEditorOpen', 'recurrenceScopeOpen', 'occurrenceRescheduleOpen', 'topicEditorOpen', 'groupEditorOpen', 'selectedTaskId', 'selectedOccurrenceId', 'showFocus'].map((name) => [name, { value: true as unknown }]))
  let focused = 0
  const capture = action('handleQuickAdd', { ...refs, page: { value: 'calendar' }, calendarWorkspace: { value: { openToolbarEvent: () => focused++ } }, requestAnimationFrame: (run: () => void) => run(), selectSmartView: () => assert.fail('calendar capture must preserve its destination') })
  capture()
  assert.equal(focused, 1)
  assert.equal(refs.selectedTaskId!.value, '')
  assert.equal(refs.selectedOccurrenceId!.value, '')
  assert.equal(refs.showFocus!.value, false)
})

test('calendar shares one detail action interface and keeps its view mounted while focusing', () => {
  assert.equal((app.match(/<TaskDetailDrawer\b/g) ?? []).length, 1)
  assert.equal((app.match(/<TaskEditSheet\b/g) ?? []).length, 1)
  assert.match(app, /<TaskDetailDrawer\s+v-if="!taskEditorOpen"/)
  assert.match(app, /<TaskEditSheet\s+v-else/)
  assert.match(app, /:task="showFocus \? undefined : selectedTaskView"/)
  assert.match(app, /<TaskDetailDrawer[\s\S]*<TaskEditSheet[\s\S]*<\/div>\s*<\/template>/)
  assert.match(app, /v-show="!showFocus" class="tasks-layout"/)
  assert.match(app, /#context[\s\S]*?<CalendarSourceManager/)
  assert.match(app, /@quick-create-event="createQuickCalendarEvent"/)
  assert.match(app, /@expand-event="expandQuickCalendarEvent"/)
  assert.match(app, /@open="openCalendarTask"/)
  assert.match(app, /@toggle-complete="toggleTaskCompletion"/)
  assert.match(app, /@primary="taskPrimary"/)
  assert.match(app, /@occurrence-complete="executeOccurrence\(\$event, 'recurrence.complete'\)"/)
  const detail = readFileSync(new URL('../src/components/study/TaskDetailDrawer.vue', import.meta.url), 'utf8')
  assert.match(detail, /本次暂不支持专注或重开/)
  assert.match(detail, /v-if="!occurrenceId \|\| occurrenceStatus === 'pending'"/)
})

test('closing task edit dismisses the whole task rail instead of revealing detail underneath', () => {
  const taskEditorOpen = { value: true }
  const selectedTaskId = { value: 'task:one' }
  const selectedOccurrenceId = { value: 'occurrence:one' }
  const reminderError = { value: 'stale error' }
  const close = action('closeTaskEditor', { taskEditorOpen, selectedTaskId, selectedOccurrenceId, reminderError })
  close()
  assert.equal(taskEditorOpen.value, false)
  assert.equal(selectedTaskId.value, '')
  assert.equal(selectedOccurrenceId.value, '')
  assert.equal(reminderError.value, '')
  assert.match(app, /<TaskEditSheet\b[^>]*@close="closeTaskEditor"/)
})

test('finishing focus returns to the calendar while preserving the existing Today return elsewhere', async () => {
  for (const origin of ['calendar', 'tasks']) {
    const showFocus = { value: true }
    const completionOpen = { value: true }
    const destinations: unknown[] = []
    let completed = 0
    const finish = action('completeFocus', {
      completionReminderId: { value: '' }, completionOccurrenceId: { value: '' }, completionTaskId: { value: '' },
      activeSession: { value: { id: 'session:one' } }, activeTask: { value: { id: 'task:one' } },
      page: { value: origin }, showFocus, completionOpen, weeklyNext: { value: '' },
      completeStudyTask: async () => { completed++ }, refreshState: async () => {}, notify: () => {},
      setDestination: (value: unknown) => destinations.push(value), reportStorageError: (error: unknown) => { throw error },
    })
    await finish({ learned: 'Done', evidence: 'Notes', blocker: '', nextAction: '', mastery: 3 })
    assert.equal(completed, 1)
    assert.equal(completionOpen.value, false)
    assert.deepEqual(destinations, origin === 'calendar' ? [] : [{ kind: 'today' }])
    if (origin === 'calendar') assert.equal(showFocus.value, false)
  }
})
