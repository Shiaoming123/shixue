import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { release as osRelease } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PUBLIC_MSI = Object.freeze({
  tag: 'v0.3.0', version: '0.3.0', source: 'ccad25b60d1b4e48b3a7f7fd168578f18c4ac947',
  tagObject: 'd7f37694b389ed8fd54ab6ba10431fe8f641642d',
  assetId: 548505376, file: 'Shixue_0.3.0_x64.msi', bytes: 11386880,
  sha256: '31968702dcd09372cc89f39a37b28614cfa7a44cefc44b420325d2320226cd4c',
  url: 'https://github.com/Shiaoming123/shixue/releases/download/v0.3.0/Shixue_0.3.0_x64.msi',
})

export function assertHostedWindows(platform, env) {
  if (platform !== 'win32' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || env.RUNNER_OS !== 'Windows' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REPOSITORY !== 'Shiaoming123/shixue') {
    throw new Error('This staging entrypoint requires the manual GitHub-hosted Windows workflow.')
  }
}

export function validatePublicMsiRelease(release) {
  if (release?.tag_name !== PUBLIC_MSI.tag || release.target_commitish !== PUBLIC_MSI.source
    || release.draft !== false || release.prerelease !== false) throw new Error('Public MSI release source mismatch.')
  const matches = release.assets?.filter((asset) => asset.name === PUBLIC_MSI.file)
  const asset = matches?.[0]
  if (matches?.length !== 1 || asset.id !== PUBLIC_MSI.assetId || asset.size !== PUBLIC_MSI.bytes
    || asset.digest !== `sha256:${PUBLIC_MSI.sha256}` || asset.browser_download_url !== PUBLIC_MSI.url
    || asset.state !== 'uploaded') throw new Error('Public MSI release asset mismatch.')
  return asset
}

export function validatePublicMsiTag(ref, tag) {
  if (ref?.object?.type !== 'tag' || ref.object.sha !== PUBLIC_MSI.tagObject
    || tag?.tag !== PUBLIC_MSI.tag || tag.object?.type !== 'commit' || tag.object.sha !== PUBLIC_MSI.source) {
    throw new Error('Public MSI tag no longer resolves to its pinned source.')
  }
}

export function validatePublicMsiBytes(bytes) {
  if (bytes.length !== PUBLIC_MSI.bytes) throw new Error('Public MSI download size mismatch.')
  if (createHash('sha256').update(bytes).digest('hex') !== PUBLIC_MSI.sha256) throw new Error('Public MSI download SHA-256 mismatch.')
}

async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Public MSI request failed: HTTP ${response.status}`)
  return response
}

async function main() {
  // Environment checks prevent accidental local use; the workflow's hosted VM provides isolation.
  assertHostedWindows(process.platform, process.env)
  if (process.argv.length !== 2) throw new Error('Public MSI staging accepts no arguments.')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const evidence = resolve(root, 'src-tauri/target/public-windows-msi')
  await mkdir(resolve(root, 'src-tauri/target'), { recursive: true })
  await mkdir(evidence)
  const report = { schemaVersion: 1, result: 'FAIL', publicMsi: PUBLIC_MSI,
    smokeSource: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    runnerOs: osRelease(), runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    generatedAt: new Date().toISOString() }
  try {
    const api = 'https://api.github.com/repos/Shiaoming123/shixue'
    const [release, ref, tag, config, pkg] = await Promise.all([
      request(`${api}/releases/tags/${PUBLIC_MSI.tag}`).then((response) => response.json()),
      request(`${api}/git/ref/tags/${PUBLIC_MSI.tag}`).then((response) => response.json()),
      request(`${api}/git/tags/${PUBLIC_MSI.tagObject}`).then((response) => response.json()),
      readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8').then(JSON.parse),
      readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
    ])
    validatePublicMsiRelease(release)
    validatePublicMsiTag(ref, tag)
    if (pkg.version !== PUBLIC_MSI.version || config.version !== PUBLIC_MSI.version
      || config.identifier !== 'com.shiaoming123.shixue' || config.productName !== '拾学') {
      throw new Error('Smoke checkout identity does not match the pinned public MSI.')
    }
    const bytes = Buffer.from(await (await request(PUBLIC_MSI.url)).arrayBuffer())
    validatePublicMsiBytes(bytes)
    const manifest = { schemaVersion: 1, version: PUBLIC_MSI.version, platform: 'windows',
      identifier: config.identifier, signing: 'unsigned-public',
      artifacts: [{ kind: 'msi', file: PUBLIC_MSI.file, bytes: PUBLIC_MSI.bytes, sha256: PUBLIC_MSI.sha256 }] }
    const parent = resolve(root, 'release-artifacts/windows')
    await mkdir(parent, { recursive: true })
    const directory = resolve(parent, PUBLIC_MSI.version)
    await mkdir(directory)
    await writeFile(resolve(directory, PUBLIC_MSI.file), bytes, { flag: 'wx' })
    await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await writeFile(resolve(evidence, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    report.result = 'PASS'
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    await writeFile(resolve(evidence, 'download-verification.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
