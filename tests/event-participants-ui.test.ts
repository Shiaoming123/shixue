import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import * as eventForm from '../src/domain/calendar/event-form.ts'
import * as workspaceParser from '../src/domain/workspace/parse.ts'
import type { CalendarEvent } from '../src/domain/calendar/types.ts'

function mount(event: CalendarEvent | null = null, external = false) {
  const props = Vue.reactive({ open: true, event, sources: [{ id: 'local', provider: external ? 'google' : 'local', permission: external ? 'read' : 'write', archivedAt: null, timezone: 'UTC', title: 'Calendar' }], initialDate: '2026-09-09', submitting: false })
  const { descriptor } = parse(readFileSync(new URL('../src/components/calendar/CalendarEventEditor.vue', import.meta.url), 'utf8'))
  const code = ts.transpileModule(compileScript(descriptor, { id: 'participants-test' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => id === 'vue' ? Vue : id.endsWith('/event-form') ? eventForm : id.endsWith('/parse.ts') ? workspaceParser : {}, exported)
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const events: any[][] = []; let state: any
  const app = renderer.createApp({ setup() { state = exported.default.setup(props, { expose() {}, emit: (...args: any[]) => events.push(args) }); return () => Vue.h('div') } })
  app.mount({})
  return { props, state, events, unmount: () => app.unmount() }
}

test('local participant editing emits only event facts, shares parser validation and preserves readonly source responses', () => {
  const h = mount()
  h.state.title.value = 'Local meeting'; h.state.organizerName.value = 'Organizer'; h.state.organizerEmail.value = 'organizer@example.com'
  h.state.addAttendee(); Object.assign(h.state.attendees.value[0], { name: 'Guest', email: 'guest@example.com', role: 'optional', response: 'tentative' })
  h.state.save()
  assert.equal(h.events.length, 1)
  const command = h.events[0]![1]
  assert.equal(command.type, 'event.create')
  assert.deepEqual(command.event.organizer, { name: 'Organizer', email: 'organizer@example.com' })
  assert.deepEqual(command.event.attendees, [{ name: 'Guest', email: 'guest@example.com', role: 'optional', response: 'tentative' }])
  h.state.attendees.value[0].email = 'invalid'; h.state.save()
  assert.equal(h.events.length, 1); assert.match(h.state.localError.value, /email/)
  h.state.attendees.value[0].email = 'guest@example.com'; h.state.addAttendee()
  Object.assign(h.state.attendees.value[1], { email: 'GUEST@example.com' }); h.state.save()
  assert.equal(h.events.length, 1); assert.match(h.state.localError.value, /Duplicate/)
  h.unmount()
  const event: CalendarEvent = { ...command.event, id: 'existing', sourceId: 'local', revision: 7, createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', deletedAt: null }
  const before = structuredClone(event)
  const edit = mount(event)
  edit.state.save()
  assert.equal(edit.events[0]![1].expectedRevision, 7)
  assert.deepEqual(edit.events[0]![1].patch.attendees, before.attendees)
  assert.deepEqual(edit.events[0]![1].patch.organizer, before.organizer)
  edit.state.removeAttendee(0); edit.state.save()
  assert.deepEqual(edit.events.at(-1)![1].patch.attendees, [])
  assert.deepEqual(event, before); edit.unmount()
  const readonly = mount(event, true)
  assert.equal(readonly.state.disabled.value, true)
  readonly.state.addAttendee(); readonly.state.removeAttendee(0); readonly.state.save()
  assert.deepEqual(Vue.toRaw(readonly.state.attendees.value), before.attendees)
  assert.equal(readonly.events.length, 0); assert.deepEqual(event, before)
  readonly.unmount()
})
