import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { desktopWorkspaceNavigation } from '../src/lib/workspace-view.ts'

const sidebar = readFileSync(new URL('../src/components/study/AppSidebar.vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('global search is a shell command and leaves the five domains unchanged', () => {
  assert.equal(desktopWorkspaceNavigation.length, 5)
  assert.deepEqual(desktopWorkspaceNavigation.map(({ label }) => label), [
    '收件箱', '今天', '日历', '清单', '学习',
  ])
  assert.doesNotMatch(sidebar, /search: \[\]|class="search-command"|aria-keyshortcuts="Control\+K Meta\+K"/)
  assert.equal((app.match(/aria-keyshortcuts="Control\+K Meta\+K"/g) ?? []).length, 1)
})

test('task pages do not duplicate the global search field', () => {
  const tasks = readFileSync(new URL('../src/components/study/TasksView.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(tasks, /aria-label="搜索任务"|placeholder="搜索"/)
  assert.match(tasks, /<div v-if="toolbarOpen \|\| searchModel" class="filters">\s*<label class="search-field">/)
  assert.match(tasks, /aria-label="筛选当前清单"/)
  assert.match(tasks, /toolbarOpen.value = true; await nextTick\(\); searchInput.value\?\.focus\(\)/)
})

test('the single global search command keeps its accessible keyboard shortcut', () => {
  assert.match(app, /ariaLabel="全局搜索"[^>]*aria-keyshortcuts="Control\+K Meta\+K"/)
  assert.match(app, /@click="openGlobalSearch"/)
})
