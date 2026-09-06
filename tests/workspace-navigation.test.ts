import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  desktopWorkspaceNavigation,
  learningWorkspaceNavigation,
  mobileMoreWorkspaceNavigation,
  mobileWorkspaceNavigation,
  resolveShellDestination,
  resolveWorkspaceView,
  serializeShellDestination,
  serializeWorkspaceView,
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
    { kind: 'learning', section: 'review' },
  ]

  for (const view of coreViews) {
    assert.deepEqual(resolveWorkspaceView(serializeWorkspaceView(view)), view)
  }
  assert.deepEqual(resolveWorkspaceView('/unknown'), { kind: 'inbox' })
  assert.deepEqual(resolveWorkspaceView('/list/%E0%A4%A'), { kind: 'inbox' })
  assert.deepEqual(resolveShellDestination(serializeShellDestination({ kind: 'settings' })), { kind: 'settings' })
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
  assert.match(app, /function setDestination\(next: ShellDestination\)/)
  assert.doesNotMatch(app, /const page = ref|const activeSmartView = ref/)
})

test('desktop and mobile navigation expose the contracted destinations in order', () => {
  assert.deepEqual(
    desktopWorkspaceNavigation.map(({ label }) => label),
    ['收件箱', '今天', '最近 7 天', '日历', '清单', '已完成', '学习'],
  )
  assert.deepEqual(
    desktopWorkspaceNavigation.map(({ view }) => view.kind),
    ['inbox', 'today', 'upcoming', 'calendar', 'lists', 'completed', 'learning'],
  )
  assert.deepEqual(mobileWorkspaceNavigation.map(({ view }) => view.kind), ['inbox', 'today', 'calendar', 'lists', 'learning'])
  assert.deepEqual(mobileMoreWorkspaceNavigation.map(({ view }) => view.kind), ['upcoming', 'completed'])
  assert.deepEqual(learningWorkspaceNavigation.map(({ view }) => view), [
    { kind: 'learning', section: 'topics' },
    { kind: 'learning', section: 'review' },
  ])
})
