import type { WriteOperation, WriteOutboxStore } from './write-outbox.ts'
type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>
/** Native device persistence only; does not enable or authorize external sends. */
export function createNativeWriteOutboxStore(invoke?: Invoke): WriteOutboxStore {
  const call = async (request: Record<string, unknown>) => {
    const execute = invoke ?? (await import('@tauri-apps/api/core')).invoke
    return execute('plugin:calendar-connections|outbox_store', { request })
  }
  return {
    insert: (operation) => call({ kind: 'insert', operation }) as Promise<boolean>,
    get: (id) => call({ kind: 'get', id }) as Promise<WriteOperation | null>,
    list: () => call({ kind: 'list' }) as Promise<WriteOperation[]>,
    claim: (id, version, leaseId, now, leaseUntil) => call({ kind: 'claim', id, version, leaseId, now, leaseUntil }) as Promise<WriteOperation | null>,
    cas: (id, version, next) => call({ kind: 'cas', id, version, next }) as Promise<boolean>,
  }
}
