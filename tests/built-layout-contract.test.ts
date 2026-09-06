import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const checker = fileURLToPath(new URL('../scripts/check-built-layout.mjs', import.meta.url))

test('built layout accepts the locked 819 compact and 820 medium boundary', () => {
  const result = runLayoutCheck(cssAtBoundary(819, 820))

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Built mobile layout contract is valid/)
})

test('built layout rejects the retired 799 compact boundary', () => {
  const result = runLayoutCheck(cssAtBoundary(799, 820))

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing the locked 819\/820 responsive rules/i)
})

test('built layout rejects a gap between compact and medium layouts', () => {
  const result = runLayoutCheck(cssAtBoundary(819, 821))

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing the locked 819\/820 responsive rules/i)
})

function cssAtBoundary(compactMax: number, mediumMin: number): string {
  return `
    @media (max-width: ${compactMax}px) {
      .shell[data-v-app] { flex-direction: column; }
      .tabbar[data-v-tabs] { bottom: max(8px, env(safe-area-inset-bottom, 0px)); }
    }
    @media (min-width: ${mediumMin}px) and (max-width: 1279px) {
      .sidebar[data-v-sidebar] { width: 72px; min-width: 72px; }
      .detail-drawer[data-v-detail] { position: fixed; }
    }
  `
}

function runLayoutCheck(css: string): ReturnType<typeof spawnSync> {
  const root = mkdtempSync(join(tmpdir(), 'shixue-layout-contract-'))
  try {
    const assets = join(root, 'dist', 'assets')
    mkdirSync(assets, { recursive: true })
    writeFileSync(join(assets, 'app.css'), css)
    return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
