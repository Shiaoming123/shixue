import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadSidebarPreferences,
  moveSidebarItem,
  saveSidebarPreferences,
  type SidebarPreferences,
} from '../src/lib/sidebar-preferences.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

function withStorage(run: (storage: MemoryStorage) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    run(storage)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

const menuKeys = ['smart:inbox', 'smart:today', 'list:learning', 'page:topics', 'page:review']

test('sidebar preferences persist display mode and a normalized menu order', () => {
  withStorage(() => {
    assert.deepEqual(loadSidebarPreferences(menuKeys), { displayMode: 'expanded', order: menuKeys })

    const saved = saveSidebarPreferences({
      displayMode: 'icons',
      order: ['page:review', 'smart:inbox', 'removed', 'smart:inbox'],
    }, menuKeys)

    assert.deepEqual(saved, {
      displayMode: 'icons',
      order: ['page:review', 'smart:inbox', 'smart:today', 'list:learning', 'page:topics'],
    })
    assert.deepEqual(loadSidebarPreferences(menuKeys), saved)
  })
})

test('damaged sidebar storage fails safe and a new menu item is appended', () => {
  withStorage((storage) => {
    storage.setItem('shixue:sidebar-preferences:v1', '{bad json')
    assert.deepEqual(loadSidebarPreferences(menuKeys), { displayMode: 'expanded', order: menuKeys })

    storage.setItem('shixue:sidebar-preferences:v1', JSON.stringify({
      displayMode: 'icons',
      order: ['page:review', 'smart:inbox'],
    } satisfies SidebarPreferences))
    assert.deepEqual(loadSidebarPreferences([...menuKeys, 'page:settings']).order.at(-1), 'page:settings')
  })
})

test('keyboard and drag ordering share the same deterministic move helper', () => {
  assert.deepEqual(
    moveSidebarItem(menuKeys, 'page:review', 'smart:today'),
    ['smart:inbox', 'page:review', 'smart:today', 'list:learning', 'page:topics'],
  )
  assert.deepEqual(moveSidebarItem(menuKeys, 'missing', 'smart:today'), menuKeys)
})
