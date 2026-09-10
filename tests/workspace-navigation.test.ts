import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  desktopWorkspaceNavigation,
  learningWorkspaceNavigation,
  listWorkspaceNavigation,
  mobileWorkspaceNavigation,
  renderPageForDestination,
  resolveArchivedListTransition,
  resolveShellDestination,
  resolveTaskTopicFilterTransition,
  resolveWorkspaceView,
  serializeShellDestination,
  serializeWorkspaceView,
  shouldResetTaskPriority,
  type WorkspaceView,
} from '../src/lib/workspace-view.ts'

test('workspace routes safely round-trip every canonical view', () => {
  const coreViews: WorkspaceView[] = [
    { kind: 'inbox' },
    { kind: 'today' },
    { kind: 'upcoming' },
    { kind: 'calendar' },
    { kind: 'lists' },
    { kind: 'list', listId: '课程 / 复习?day=1#top%done' },
    { kind: 'completed' },
    { kind: 'learning', section: 'topics' },
    { kind: 'learning', section: 'rhythm' },
    { kind: 'learning', section: 'review' },
  ]

  for (const view of coreViews) {
    assert.deepEqual(resolveWorkspaceView(serializeWorkspaceView(view)), view)
  }
  assert.deepEqual(resolveWorkspaceView('/unknown'), { kind: 'inbox' })
  assert.deepEqual(resolveWorkspaceView('/list/%E0%A4%A'), { kind: 'inbox' })
  assert.deepEqual(resolveShellDestination(serializeShellDestination({ kind: 'settings' })), { kind: 'settings' })
})

test('task topic filters become explicit typed navigation transitions', () => {
  assert.deepEqual(resolveTaskTopicFilterTransition('all'), {
    destination: { kind: 'lists' },
    preservePriority: true,
    topicFilter: 'all',
  })
  assert.deepEqual(resolveTaskTopicFilterTransition('unassigned'), {
    destination: { kind: 'lists' },
    preservePriority: true,
    topicFilter: 'unassigned',
  })
  assert.deepEqual(resolveTaskTopicFilterTransition('list:course / review'), {
    destination: { kind: 'list', listId: 'list:course / review' },
    preservePriority: true,
    topicFilter: 'list:course / review',
  })
  assert.equal(shouldResetTaskPriority({ kind: 'lists' }), true)
  assert.equal(shouldResetTaskPriority({ kind: 'list', listId: 'list:a' }), false)
  assert.equal(shouldResetTaskPriority({ kind: 'upcoming' }, true), false)
  assert.equal(renderPageForDestination({ kind: 'lists' }), 'topics')
  assert.equal(renderPageForDestination({ kind: 'list', listId: 'list:a' }), 'tasks')
  assert.equal(renderPageForDestination({ kind: 'learning', section: 'topics' }), 'topics')
  assert.equal(renderPageForDestination({ kind: 'learning', section: 'rhythm' }), 'rhythm')
})

test('archiving a list only leaves the active list destination', () => {
  assert.deepEqual(
    resolveArchivedListTransition({ kind: 'list', listId: 'list:a' }, 'list:a', 'list:a'),
    { destination: { kind: 'lists' }, preservePriority: true, topicFilter: 'all' },
  )
  assert.deepEqual(
    resolveArchivedListTransition({ kind: 'learning', section: 'topics' }, 'list:a', 'list:a'),
    { destination: { kind: 'learning', section: 'topics' }, preservePriority: true, topicFilter: 'all' },
  )
  assert.equal(
    resolveArchivedListTransition({ kind: 'list', listId: 'list:b' }, 'list:a', 'list:b'),
    null,
  )
})

test('shell controls emit one typed destination and App owns the canonical setter', () => {
  const sidebar = readFileSync(new URL('../src/components/study/AppSidebar.vue', import.meta.url), 'utf8')
  const bottomTabs = readFileSync(new URL('../src/components/study/BottomTabs.vue', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(sidebar, /navigate: \[destination: ShellDestination\]/)
  assert.doesNotMatch(sidebar, /'smart-view'|'select-list'/)
  assert.match(bottomTabs, /navigate: \[destination: WorkspaceView\]/)
  assert.doesNotMatch(bottomTabs, /'smart-view'/)
  assert.match(app, /const destination = ref<ShellDestination>\(\{ kind: 'today' \}\)/)
  assert.match(app, /function setDestination\(next: ShellDestination,/)
  assert.match(app, /<TopicsView[^>]*:lists-mode="destination\.kind === 'lists'"[^>]*@open-smart="setDestination\(\{ kind: \$event \}\)"/)
  assert.match(app, /v-for="item in learningWorkspaceNavigation"/)
  assert.match(app, /resolveTaskTopicFilterTransition\(value\)/)
  assert.doesNotMatch(app, /const page = ref|const activeSmartView = ref/)
})

test('desktop and mobile navigation expose the contracted destinations in order', () => {
  assert.deepEqual(
    desktopWorkspaceNavigation.map(({ label }) => label),
    ['收件箱', '今天', '日历', '清单', '学习'],
  )
  assert.deepEqual(
    desktopWorkspaceNavigation.map(({ view }) => view.kind),
    ['inbox', 'today', 'calendar', 'lists', 'learning'],
  )
  assert.deepEqual(mobileWorkspaceNavigation.map(({ label }) => label), ['收件箱', '今天', '日历', '清单', '学习'])
  assert.deepEqual(mobileWorkspaceNavigation.map(({ view }) => view.kind), ['inbox', 'today', 'calendar', 'lists', 'learning'])
  assert.deepEqual(listWorkspaceNavigation.map(({ label }) => label), ['最近 7 天', '已完成'])
  assert.deepEqual(listWorkspaceNavigation.map(({ view }) => view.kind), ['upcoming', 'completed'])
  assert.deepEqual(learningWorkspaceNavigation.map(({ view }) => view), [
    { kind: 'learning', section: 'topics' },
    { kind: 'learning', section: 'rhythm' },
    { kind: 'learning', section: 'review' },
  ])
})

test('legacy smart-list routes remain addressable without becoming top-level destinations', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const sidebar = readFileSync(new URL('../src/components/study/AppSidebar.vue', import.meta.url), 'utf8')
  const bottomTabs = readFileSync(new URL('../src/components/study/BottomTabs.vue', import.meta.url), 'utf8')
  assert.deepEqual(resolveWorkspaceView('/upcoming'), { kind: 'upcoming' })
  assert.deepEqual(resolveWorkspaceView('/completed'), { kind: 'completed' })
  assert.equal(serializeWorkspaceView({ kind: 'upcoming' }), '/upcoming')
  assert.equal(serializeWorkspaceView({ kind: 'completed' }), '/completed')
  assert.equal(desktopWorkspaceNavigation.some(({ view }) => view.kind === 'upcoming' || view.kind === 'completed'), false)
  assert.equal(mobileWorkspaceNavigation.some(({ view }) => view.kind === 'upcoming' || view.kind === 'completed'), false)
  assert.match(app, /<TopicsView[^>]*:lists-mode="destination\.kind === 'lists'"[^>]*@open-smart="setDestination\(\{ kind: \$event \}\)"/)
  assert.match(sidebar, /listWorkspaceNavigation/)
  assert.doesNotMatch(bottomTabs, /listWorkspaceNavigation/)
})
