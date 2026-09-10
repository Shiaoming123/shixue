import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shouldAutoSelectTask } from '../src/lib/task-detail-layout.ts'

const studySource = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')

test('only the split detail layout automatically selects the first task', () => {
  for (const width of [700, 810, 819, 820, 1279]) {
    assert.equal(shouldAutoSelectTask(width), false, `${width}px uses an overlay detail`)
  }
  for (const width of [1280, 1440]) {
    assert.equal(shouldAutoSelectTask(width), true, `${width}px uses the split detail`)
  }
})

test('opening the task editor hides the task detail modal', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /:task=\"showFocus \|\| taskEditorOpen \? undefined : selectedTaskView\"/)
})
test('task detail keeps secondary actions in More and one prominent footer action', () => {
  const detail = studySource('TaskDetailDrawer.vue')
  assert.match(detail, /import Button from ['"]\.\.\/ui\/Button\.vue['"]/)
  assert.match(detail, /import IconButton from ['"]\.\.\/ui\/IconButton\.vue['"]/)
  assert.match(detail, /import Popover from ['"]\.\.\/ui\/Popover\.vue['"]/)
  assert.match(detail, /aria-label="更多任务操作"/)
  for (const action of ['编辑任务', '延期', '标记受阻', '取消任务', '删除任务']) {
    assert.match(detail, new RegExp(`>${action}<`), `${action} is available from More`)
  }
  assert.doesNotMatch(detail, /class="secondary-actions"/)
  assert.match(detail, /<footer class="drawer-actions">[\s\S]*<Button[\s\S]*variant="prominent"[\s\S]*<\/footer>/)
})
