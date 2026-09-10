import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { desktopWorkspaceNavigation } from '../src/lib/workspace-view.ts'

const sidebar = readFileSync(new URL('../src/components/study/AppSidebar.vue', import.meta.url), 'utf8')

test('global search is a sidebar command and leaves the seven destinations unchanged', () => {
  assert.equal(desktopWorkspaceNavigation.length, 7)
  assert.deepEqual(desktopWorkspaceNavigation.map(({ label }) => label), [
    '收件箱', '今天', '最近 7 天', '日历', '清单', '已完成', '学习',
  ])
  assert.match(sidebar, /search: \[\]/)
  assert.match(sidebar, /@click="emit\('search'\)"/)
  assert.doesNotMatch(sidebar, /preferenceKey:\s*['"](?:[^'"]*search|search[^'"]*)['"]/i)

  const searchButton = sidebar.indexOf('class="search-command"')
  const navigation = sidebar.indexOf('<nav class="navigation"')
  assert.ok(searchButton >= 0 && searchButton < navigation, 'search belongs above navigation, not inside its sortable destinations')
})

test('global search has an accessible shortcut hint that collapses in both rail modes', () => {
  assert.match(sidebar, /aria-label="搜索"/)
  assert.match(sidebar, /aria-keyshortcuts="Control\+K Meta\+K"/)
  assert.match(sidebar, /<kbd class="search-shortcut"[^>]*>Ctrl K<\/kbd>/)
  assert.match(sidebar, /\.sidebar\.icons \.search-label, \.sidebar\.icons \.search-shortcut \{[^}]*max-width: 0;[^}]*opacity: 0;/)
  assert.match(sidebar, /class="mode-toggle"[\s\S]*displayMode === 'icons'/)
})
