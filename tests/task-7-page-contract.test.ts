import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('remaining core pages share one PageHeader and no local h1', () => {
  for (const path of [
    'src/components/study/TodayView.vue',
    'src/components/calendar/CalendarToolbar.vue',
    'src/components/study/TopicsView.vue',
    'src/components/study/LearningRhythmView.vue',
    'src/components/study/ReviewView.vue',
    'src/components/study/SettingsView.vue',
  ]) {
    const page = source(path)
    assert.match(page, /import PageHeader from ['"]\.\.\/ui\/PageHeader\.vue['"]/)
    assert.equal((page.match(/<PageHeader\b/g) ?? []).length, 1)
    assert.doesNotMatch(page, /<h1\b/)
  }
})

test('calendar toolbar uses shared actions and keeps all view modes', () => {
  const toolbar = source('src/components/calendar/CalendarToolbar.vue')
  assert.match(toolbar, /import IconButton from ['"]\.\.\/ui\/IconButton\.vue['"]/)
  assert.doesNotMatch(toolbar, /<button\b/)
  for (const mode of ['day', 'week', 'month', 'agenda']) assert.match(toolbar, new RegExp(`update:mode', '${mode}`))
  assert.match(toolbar, /emit\('today'\)/)
})

test('content surfaces avoid decorative material and elevation', () => {
  for (const path of [
    'src/components/study/TodayView.vue',
    'src/components/study/TopicsView.vue',
    'src/components/study/LearningRhythmView.vue',
    'src/components/study/ReviewView.vue',
    'src/components/study/SettingsView.vue',
  ]) {
    const page = source(path)
    assert.doesNotMatch(page, /var\(--material-/)
    assert.doesNotMatch(page, /var\(--shadow-/)
  }
  assert.doesNotMatch(source('src/components/study/TodayView.vue'), /\.start-button[^}]*box-shadow/)
})

test('Task 7 pages route visible actions through shared controls', () => {
  for (const path of [
    'src/components/study/TodayView.vue',
    'src/components/study/TopicsView.vue',
    'src/components/study/LearningRhythmView.vue',
    'src/components/study/ReviewView.vue',
    'src/components/study/SettingsView.vue',
  ]) assert.doesNotMatch(source(path), /<button\b/)
})

test('Lists landing shows smart lists before user lists and moves group creation under More', () => {
  const topics = source('src/components/study/TopicsView.vue')
  const app = source('src/App.vue')
  assert.match(topics, /最近 7 天[\s\S]*已完成[\s\S]*用户清单/)
  assert.match(topics, /更多[\s\S]*新建分组/)
  assert.match(app, /destination\.kind === 'lists' \|\| destination\.kind === 'learning'/)
  assert.match(app, /<TopicsView[^>]*:lists-mode="destination\.kind === 'lists'"/)
  assert.match(app, /<TopicsView[^>]*@open-smart="setDestination\(\{ kind: \$event \}\)"/)
  assert.match(topics, /listsMode\?: boolean/)
  assert.match(topics, /v-if="listsMode"/)
})
