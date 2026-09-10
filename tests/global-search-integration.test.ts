import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const review = readFileSync(new URL('../src/components/study/ReviewView.vue', import.meta.url), 'utf8')

test('App exposes one global search overlay from desktop, mobile, and Ctrl or Command K', () => {
  assert.match(app, /<AppSidebar\b[^>]*@search="openGlobalSearch"/)
  assert.match(app, /class="mobile-actions"[\s\S]*<IconButton label="全局搜索"/)
  assert.match(app, /<GlobalSearchDialog\b[^>]*v-model:open="globalSearchOpen"/)
  assert.match(app, /\(event\.ctrlKey \|\| event\.metaKey\)/)
  assert.match(app, /event\.key\.toLocaleLowerCase\(\) !== 'k'/)
  assert.match(app, /window\.addEventListener\('keydown', handleGlobalSearchShortcut\)/)
  assert.match(app, /window\.removeEventListener\('keydown', handleGlobalSearchShortcut\)/)
})

test('task and record results return to their exact canonical targets', () => {
  assert.match(app, /setDestination\(destinationForSearchTask\(task, activeListIds\)\)[\s\S]*selectedTaskId\.value = task\.id/)
  assert.match(app, /recordTarget\.value = \{ id: record\.id, requestId: \+\+recordTargetRequestId \}/)
  assert.match(app, /setDestination\(\{ kind: 'learning', section: 'review' \}\)/)
  assert.match(app, /<ReviewView\b[^>]*:record-target="recordTarget"/)
  assert.match(review, /watch\(\(\) => props\.recordTarget[\s\S]*selectedRecordId\.value = target\.id/)
  assert.match(review, /:data-record-id="record\.id"/)
})

test('tag management uses a fresh workspace revision, unique receipt key, refresh, and undo seam', () => {
  assert.match(app, /snapshotRevision: async \(\) => \(await capabilityService\.query\(\{ type: 'workspace\.snapshot' \}\)\)\.revision/)
  assert.match(app, /idempotencyKey: `tag-ui:\$\{crypto\.randomUUID\(\)\}`/)
  assert.match(app, /source: 'human-ui',[\s\S]*expectedWorkspaceRevision,[\s\S]*command,/)
  assert.match(app, /refresh: refreshState,[\s\S]*successAction: calendarUndoAction/)
  assert.match(app, /<TaskEditSheet\b[^>]*@manage-tags="openTagManager\(\)"/)
  assert.match(app, /<GlobalSearchDialog\b[^>]*@manage-tags="openTagManager\(true\)"/)
  assert.match(app, /function closeTagManager\(\)[\s\S]*nextTick\(openGlobalSearch\)/)
  assert.match(app, /<TagManagerSheet\b/)
})
