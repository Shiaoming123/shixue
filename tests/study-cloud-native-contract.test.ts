import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('native Supabase sync is an opt-in Cargo feature using existing optional dependencies', () => {
  const cargo = readFileSync(new URL('src-tauri/Cargo.toml', root), 'utf8')
  assert.match(cargo, /^default = \[(?![^\]]*"sync")[^\]]*\]$/m)
  assert.match(cargo, /^sync = \["dep:keyring", "dep:reqwest"\]$/m)
  assert.match(cargo, /^keyring = \{ version = "4", optional = true \}$/m)
  assert.match(cargo, /^reqwest = \{[^\n]*optional = true[^\n]*\}$/m)
})

test('native commands are compiled and registered only with the sync feature', () => {
  const lib = readFileSync(new URL('src-tauri/src/lib.rs', root), 'utf8')
  assert.match(lib, /#\[cfg\(feature = "sync"\)\]\s*mod study_cloud;/)
  for (const command of [
    'study_cloud_sign_in',
    'study_cloud_session_status',
    'study_cloud_sign_out',
    'study_cloud_pull',
    'study_cloud_push',
  ]) {
    assert.match(lib, new RegExp(`study_cloud::${command}`))
  }
})

test('migration enforces owner-scoped RLS and an invoker-rights CAS RPC', () => {
  const migrations = readdirSync(new URL('supabase/migrations/', root))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  assert.ok(migrations.length > 0, 'a Supabase migration must exist')
  const sql = migrations
    .map((name) => readFileSync(new URL(`supabase/migrations/${name}`, root), 'utf8'))
    .join('\n')
    .toLowerCase()

  assert.match(sql, /create table[^;]*study_cloud_snapshots/)
  assert.match(sql, /owner_id uuid[^,]*(primary key|unique)/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /grant select, insert, update[^;]*authenticated/)
  assert.match(sql, /for select[^;]*auth\.uid\(\)\s*=\s*owner_id/)
  assert.match(sql, /for insert[^;]*with check[^;]*auth\.uid\(\)\s*=\s*owner_id/)
  assert.match(sql, /for update[^;]*using[^;]*auth\.uid\(\)\s*=\s*owner_id[^;]*with check[^;]*auth\.uid\(\)\s*=\s*owner_id/)
  assert.match(sql, /create or replace function[^;]*study_cloud_cas_snapshot/)
  assert.match(sql, /security invoker/)
  assert.doesNotMatch(sql, /security definer/)
  assert.match(sql, /grant execute on function[^;]*authenticated/)
  assert.match(sql, /revoke all on function[^;]*from public/)
})
