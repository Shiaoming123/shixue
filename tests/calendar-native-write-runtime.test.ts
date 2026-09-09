import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createNativeCalendarWriteRuntime } from '../src/calendar-connections/native-write-runtime.ts'
import { createInMemoryWorkspaceStore } from '../src/storage/study/in-memory.ts'
import { canonicalJson, createTaskCapabilityService, fingerprintWorkspace } from '../src/domain/capabilities/service.ts'
import { normalizeNativeCalendarBatch } from '../src/calendar-connections/runtime.ts'
import { stableId } from '../src/calendar-connections/types.ts'
import type { WorkspaceStore } from '../src/storage/workspace/types.ts'
import { parseWorkspaceExport } from '../src/storage/workspace/data-port.ts'

async function fixture() {
  const store = createInMemoryWorkspaceStore(), initial = await store.load()
  let binding: any = null, sequence = 0, failAck = false, title = 'Current remote title', reads = 0
  const acknowledged = new Set<string>()
  let gate = Promise.resolve()
  const invoke = async (command: string, args: Record<string, unknown>) => {
    assert.equal(args.operationId, 'confirmed-operation')
    if (command.endsWith('|write_stage_local')) {
      let result: any
      gate = gate.then(async () => {
        const state = await store.load(), hash = await fingerprintWorkspace(state)
        const receipt = state.commandReceipts.find((r) => r.idempotencyKey === binding?.batchId && Date.parse(r.expiresAt) > Date.now())
        if (!binding || (!receipt && (acknowledged.has(binding.batchId) || binding.expectedWorkspaceHash !== hash))) binding = { batchId: `write-local:${++sequence}`, operationId: 'confirmed-operation', expectedWorkspaceHash: hash, provider: 'google', connectionId: 'connection', calendarId: 'calendar', sourceId: stableId('google', 'connection', 'calendar'), mode: 'full', access: 'details', title: 'Remote', timezone: 'UTC', items: [{ id: 'event', summary: title, start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }] }
        binding.observedAt ??= '2026-09-09T00:00:00.000Z'
        result = structuredClone(binding)
      })
      await gate; return result
    }
    if (command.endsWith('|write_read_local')) { reads++; assert.equal(args.batchId, binding.batchId); return structuredClone(binding) }
    assert.equal(command, 'plugin:calendar-connections|write_ack_local')
    const state = await store.load(), receipt = state.commandReceipts.find((r) => r.id === args.workspaceReceiptId)
    assert.ok(receipt); assert.equal(receipt.idempotencyKey, binding.batchId)
    assert.equal((receipt.result.data as any).operationId, args.operationId)
    if (failAck) throw new Error('Native ack interrupted')
    acknowledged.add(binding.batchId)
    return { operationId: args.operationId, batchId: args.batchId, applied: true }
  }
  const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'connection' }, invoke })
  return { store, initial, runtime, invoke, reads: () => reads, failAck: (value: boolean) => { failAck = value }, title: (value: string) => { title = value } }
}

test('concurrent callbacks converge on one atomic event and operation receipt without mirror data', async () => {
  const h = await fixture()
  const results = await Promise.all([h.runtime.applyLocal('confirmed-operation', h.store), h.runtime.applyLocal('confirmed-operation', h.store)])
  assert.deepEqual(results[0], results[1])
  const state = await h.store.load()
  assert.equal(state.calendarEvents.length, 1); assert.equal(state.calendarEvents[0]!.revision, 1)
  assert.equal(state.commandReceipts.length, 1); assert.deepEqual(state.tasks, h.initial.tasks)
  assert.equal('expectedWorkspaceHash' in (state.commandReceipts[0]!.result.data as object), false)
})

test('save CAS failure re-stages current remote facts; lost ack retries only the existing receipt', async () => {
  const h = await fixture(); let saves = 0
  const raced: WorkspaceStore = { ...h.store, async save(state, expected) {
    if (++saves === 1) {
      const current = await h.store.load(), old = current.updatedAt
      current.revision++; current.updatedAt = new Date(Date.parse(old) + 1).toISOString()
      current.calendarSources[0]!.title = 'Preserved preference'; h.title('Newer remote title')
      await h.store.save(current, old)
    }
    return h.store.save(state, expected)
  } }
  h.failAck(true)
  await assert.rejects(h.runtime.applyLocal('confirmed-operation', raced), /WRITE_LOCAL_APPLIED_ACK_PENDING/)
  const applied = await h.store.load()
  assert.equal(applied.calendarEvents[0]!.title, 'Newer remote title')
  assert.equal(applied.calendarSources[0]!.title, 'Preserved preference')
  h.failAck(false); await h.runtime.applyLocal('confirmed-operation', raced)
  assert.deepEqual(await h.store.load(), applied)
})

test('receipt pruning or old Workspace restore reads current remote state without reusing old write facts', async () => {
  for (const restore of [false, true]) {
    const h = await fixture(); await h.runtime.applyLocal('confirmed-operation', h.store)
    const old = await h.store.load(), state = restore ? structuredClone(h.initial) : structuredClone(old)
    state.commandReceipts = []; await h.store.save(state, old.updatedAt)
    h.title('Latest remote edit')
    const result = await h.runtime.applyLocal('confirmed-operation', h.store)
    assert.equal(result.batchId, 'write-local:2')
    assert.equal((await h.store.load()).calendarEvents[0]!.title, 'Latest remote edit')
    assert.deepEqual((await h.store.load()).tasks, h.initial.tasks)
  }
})

test('unavailable native endpoints and forged operation bindings cannot manufacture successful apply', async () => {
  const store = createInMemoryWorkspaceStore(), before = await store.load()
  for (const enabled of [false, true]) {
    const runtime = createNativeCalendarWriteRuntime({ enabled, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'connection' }, invoke: async () => { throw 'private token response' } })
    await assert.rejects(runtime.applyLocal('confirmed-operation', store), /WRITE_(UNAVAILABLE|LOCAL_NATIVE_UNAVAILABLE)/)
  }
  const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'connection' }, invoke: async () => ({ operationId: 'forged', connectionId: 'connection' }) })
  await assert.rejects(runtime.applyLocal('confirmed-operation', store), /WRITE_LOCAL_IDENTITY/)
  assert.deepEqual(await store.load(), before)
})

test('workspace hash canonicalizes JSON numeric forms and UTF-16 key order for native golden vectors', async () => {
  const state = await createInMemoryWorkspaceStore().load()
  // Domain state uses this same canonical encoder; include JSON receipt data to exercise cross-language edges.
  const values = JSON.parse('{"\\ue000":1.0,"😀":1e-7,"a":1e21,"z":0.000001}')
  assert.equal(canonicalJson(values), '{"a":1e+21,"z":0.000001,"😀":1e-7,"":1}')
  assert.equal(canonicalJson(JSON.parse('[1.0,1,-0,1e-7,1e21]')), '[1,1,0,1e-7,1e+21]')
  assert.equal(await fingerprintWorkspace(state), `sha256:${createHash('sha256').update(canonicalJson(state)).digest('hex')}`)
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/calendar-workspace-hash-v4.json', import.meta.url), 'utf8'))
  const migrated = parseWorkspaceExport(readFileSync(new URL('./fixtures/calendar-workspace-v3.json', import.meta.url), 'utf8')).state
  assert.deepEqual(fixture.state, migrated)
  assert.equal(await fingerprintWorkspace(migrated), fixture.hash)
})

test('native projection fixture is the actual service output, with observed timestamps and preserved local facts', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/calendar-write-projection.json', import.meta.url), 'utf8'))
  for (const { base, current, batch } of fixture.cases) {
    const store = createInMemoryWorkspaceStore(base)
    const receipt = current.commandReceipts.find((entry: any) => entry.idempotencyKey === batch.batchId)
    const service = createTaskCapabilityService(store, () => receipt.createdAt, () => receipt.id, {
      loadExternalBatch: async (_id, state) => ({ ...normalizeNativeCalendarBatch(batch, batch.connectionId, batch.calendarId, batch.observedAt, state.calendarEvents), operationId: batch.operationId, expectedWorkspaceHash: batch.expectedWorkspaceHash }),
    })
    await service.execute({ protocolVersion: 1, source: 'human-ui', idempotencyKey: batch.batchId, expectedWorkspaceRevision: base.revision, command: { type: 'calendar_external.apply', batchId: batch.batchId } })
    assert.deepEqual(await store.load(), current, batch.batchId)
  }
})

test('native write batches require a frozen recurrence plan before local projection', () => {
  const raw = { batchId: 'batch', operationId: 'root', provider: 'google', connectionId: 'connection', calendarId: 'calendar', sourceId: stableId('google', 'connection', 'calendar'), mode: 'incremental', access: 'details', title: 'Remote', timezone: 'UTC', observedAt: '2026-09-09T00:00:00.000Z', expectedWorkspaceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', items: [{ id: 'parent', recurrence: ['RRULE:FREQ=DAILY'], start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }] }
  assert.throws(() => normalizeNativeCalendarBatch(raw, 'connection', 'calendar', raw.observedAt, []), /invalid-response/)
})

test('sender bridge is default off, preserves native cancellation, and returns only safe whitelisted responses', async () => {
  const config = { clientId: null, connectionId: 'connection' }, runtimeInfo = { platform: 'desktop' as const, capabilities: [] }
  const closed = createNativeCalendarWriteRuntime({ runtime: runtimeInfo, config, invoke: async () => assert.fail('default off cannot invoke IPC') })
  for (const method of ['run', 'lookup', 'reconcile'] as const) await assert.rejects(closed[method]('operation'), /WRITE_UNAVAILABLE/)
  const calls: Array<{ command: string; args: Record<string, unknown> }> = []
  let cancelled = true
  const hash = `sha256:${'a'.repeat(64)}`
  const intent = { kind: 'cancel' as const, eventId: 'remote-event', etag: 'v1' }
  const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: runtimeInfo, config, invoke: async (command, args) => {
    calls.push({ command, args }); assert.deepEqual(args.config, config)
    if (command.endsWith('|write_prepare')) return { operationId: 'operation', hash, expiresAt: Date.now() + 60_000, token: 'private-sentinel', preview: { operationId: 'operation', hash, connectionId: 'connection', calendarId: 'calendar', eventId: 'remote-event', sendUpdates: 'all', intent: { ...intent, headers: { Authorization: 'private-sentinel' } }, token: 'private-sentinel' } }
    if (command.endsWith('|write_confirm')) { if (cancelled) throw 'WRITE_CONFIRM_CANCELLED'; return { confirmed: true, token: 'private-sentinel' } }
    if (command.endsWith('|write_disable')) return { enabled: false, token: 'private-sentinel' }
    return { operationId: 'operation', state: 'applied', outcomeUnknown: false, result: { operationId: 'operation', connectionId: 'connection', calendarId: 'calendar', eventId: 'remote-event', etag: 'v2', token: 'private-sentinel' }, token: 'private-sentinel' }
  } })
  const prepared = await runtime.prepare('calendar', Object.assign({}, intent, { url: 'https://wrong.invalid', headers: { Authorization: 'private-sentinel' } }), 'all')
  assert.equal(JSON.stringify(prepared).includes('private-sentinel'), false)
  assert.deepEqual(calls[0]!.args, { config, calendarId: 'calendar', intent, sendUpdates: 'all' })
  await assert.rejects(runtime.confirm(prepared.operationId, prepared.hash), /WRITE_CONFIRM_CANCELLED/)
  assert.equal(calls.some(({ command }) => command.endsWith('|write_run')), false, 'Cancelled native confirmation never triggers a send')
  cancelled = false; assert.deepEqual(await runtime.confirm(prepared.operationId, prepared.hash), { confirmed: true })
  for (const method of ['run', 'lookup', 'reconcile'] as const) {
    assert.equal(JSON.stringify(await runtime[method]('operation')).includes('private-sentinel'), false)
    assert.deepEqual(calls.at(-1)!.args, { config, operationId: 'operation' })
  }
  assert.deepEqual(await runtime.disable(), { enabled: false })
  assert.deepEqual(calls.at(-1)!.args, { config })
})

test('sender bridge rejects mismatched safe identities and hides arbitrary native errors', async () => {
  for (const response of [{ operationId: 'other', state: 'failed', outcomeUnknown: true, result: null }, { operationId: 'operation', state: 'applied', outcomeUnknown: false, result: null }]) {
    const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'connection' }, invoke: async () => response })
    await assert.rejects(runtime.lookup('operation'), /WRITE_RESPONSE_INVALID/)
  }
  const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'connection' }, invoke: async () => { throw 'https://provider.invalid/?token=private-sentinel' } })
  await assert.rejects(runtime.lookup('operation'), { message: 'WRITE_LOCAL_NATIVE_UNAVAILABLE' })
})

test('safe native baseline-stale codes cause bounded local re-stage without any sender call', async () => {
  for (const operation of ['write_stage_local', 'write_read_local', 'write_ack_local']) {
    const h = await fixture(); let staleCount = 0, stages = 0
    const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'connection' }, invoke: async (command, args) => {
      if (command.endsWith('|write_stage_local')) stages++
      assert.ok(['write_stage_local', 'write_read_local', 'write_ack_local'].some((name) => command.endsWith(`|${name}`)))
      if (command.endsWith(`|${operation}`) && staleCount++ === 0) throw 'WRITE_LOCAL_BASELINE_STALE'
      return h.invoke(command, args)
    } })
    await runtime.applyLocal('confirmed-operation', h.store)
    assert.equal(stages, 2)
    assert.equal((await h.store.load()).calendarEvents[0]!.revision, 1)
  }
  let stages = 0
  const runtime = createNativeCalendarWriteRuntime({ enabled: true, runtime: { platform: 'desktop', capabilities: [] }, config: { clientId: null, connectionId: 'connection' }, invoke: async () => { stages++; throw 'WRITE_LOCAL_BASELINE_STALE' } })
  await assert.rejects(runtime.applyLocal('operation', createInMemoryWorkspaceStore()), /WRITE_LOCAL_BASELINE_STALE/)
  assert.equal(stages, 3)
})
