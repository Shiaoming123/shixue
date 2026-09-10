import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseWorkspaceStateOrMigrate } from '../src/domain/workspace/migrate.ts'
import { listAccentPalette, listIconIds, resolveListAppearance } from '../src/lib/list-appearance.ts'
import { projectWorkspaceState } from '../src/lib/study.ts'
import { createSeedStudyState, parseStudyState } from '../src/storage/study/types.ts'

const studySource = (name: string) => readFileSync(new URL(`../src/components/study/${name}`, import.meta.url), 'utf8')

test('list appearance accepts explicit choices and gives legacy lists a stable identity', () => {
  assert.deepEqual(resolveListAppearance('legacy-list', 'code', '#3B82F6'), { icon: 'code', color: '#3B82F6' })
  assert.deepEqual(resolveListAppearance('legacy-list', 'unknown', 'red'), resolveListAppearance('legacy-list'))
  assert.deepEqual(resolveListAppearance('legacy-list'), resolveListAppearance('legacy-list'))
  assert.equal(resolveListAppearance('legacy-list').icon, 'folder')
  assert.ok(listIconIds.includes(resolveListAppearance('legacy-list').icon))
  assert.ok(listAccentPalette.some(({ value }) => value === resolveListAppearance('legacy-list').color))
  assert.notDeepEqual(resolveListAppearance('a'), resolveListAppearance('b'))
})

test('stored list appearance is optional, validated, and survives parsing', () => {
  const state = createSeedStudyState('2026-09-10T00:00:00.000Z')
  state.topics[0].icon = 'code'
  state.topics[0].color = '#3B82F6'
  const parsed = parseStudyState(structuredClone(state))
  assert.equal(parsed.topics[0].icon, 'code')
  assert.equal(parsed.topics[0].color, '#3B82F6')
  const workspace = parseWorkspaceStateOrMigrate(parsed, '2026-09-10T01:00:00.000Z')
  assert.equal(workspace.lists.find(({ id }) => id === parsed.topics[0].id)?.icon, 'code')
  assert.equal(projectWorkspaceState(workspace).topics[0].color, '#3B82F6')

  const invalid = structuredClone(state) as unknown as { topics: Array<{ icon: string; color: string }> }
  invalid.topics[0].icon = 'rocket'
  assert.throws(() => parseStudyState(invalid), /icon/)
  invalid.topics[0].icon = 'code'
  invalid.topics[0].color = 'blue'
  assert.throws(() => parseStudyState(invalid), /color/)
})

test('sidebar and topics use one labelled create menu instead of ambiguous sibling icons', () => {
  const menu = studySource('ListCreateMenu.vue')
  const sidebar = studySource('AppSidebar.vue')
  const topics = studySource('TopicsView.vue')

  assert.match(menu, /<IconButton[^>]*label="新建清单或分组"/)
  assert.match(menu, /role="menu"/)
  assert.match(menu, /<strong>新建清单<\/strong><small>收纳具体任务和学习步骤<\/small>/)
  assert.match(menu, /<strong>新建分组<\/strong><small>归类多个清单，不直接存放任务<\/small>/)
  assert.match(sidebar, /<ListCreateMenu[^>]*@create-list="emit\('create-list'\)"[^>]*@create-group="emit\('create-group'\)"/)
  assert.match(topics, /<ListCreateMenu[^>]*@create-list="emit\('create'\)"[^>]*@create-group="emit\('createGroup'\)"/)
  assert.doesNotMatch(sidebar, /title="新建分组"[\s\S]*title="新建清单"/)
})

test('lists, groups, actions, and long text keep distinct fixed layout roles', () => {
  const sidebar = studySource('AppSidebar.vue')
  const topics = studySource('TopicsView.vue')

  assert.match(sidebar, /icon\?: ListIconId; color\?: string/)
  assert.match(sidebar, /:style="listIdentityStyle\(list\)"/)
  assert.match(sidebar, /<IconButton[^>]*:label="`编辑分组 \$\{section\.title\}`"/)
  assert.match(topics, /<FolderTree[^>]*class="group-icon"/)
  assert.match(topics, /class="topic-identity"/)
  assert.match(topics, /class="topic-chevron"/)
  assert.match(topics, /\.topic-list button \{[^}]*grid-template-columns:\s*20px minmax\(0,\s*1fr\) 18px/)
  assert.match(topics, /\.topic-chevron \{[^}]*grid-column:\s*3/)
  assert.match(topics, /<IconButton[^>]*label="编辑清单"/)
  assert.match(topics, /<IconButton[^>]*label="归档清单"/)
  assert.match(studySource('ListAppearancePicker.vue'), /设置清单图标和颜色/)
  assert.match(topics, /updateAppearance: \[id: string, appearance: ListAppearance\]/)
})
