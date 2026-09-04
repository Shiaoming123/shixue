import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const versionPattern = /^version\s*=\s*"([^"]+)"/m

async function readText(path, errors, label) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    errors.push(`Unable to read ${label}: ${path}`)
    return undefined
  }
}

function parseJson(text, errors, label) {
  if (text === undefined) return undefined

  try {
    return JSON.parse(text)
  } catch {
    errors.push(`Invalid JSON in ${label}`)
    return undefined
  }
}

function isPlaceholderEndpoint(endpoint) {
  try {
    return new URL(endpoint).pathname.split('/').some((segment, index, segments) => (
      segment.toUpperCase() === 'OWNER' && segments[index + 1]?.toUpperCase() === 'REPO'
    ))
  } catch {
    return false
  }
}

export function validateWindowsReleaseWorkflow(workflow) {
  if (typeof workflow !== 'string') {
    return ['Missing .github/workflows/release.yml for formal release validation']
  }

  const activeWorkflow = workflow
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  const errors = []
  if (!activeWorkflow.includes('runs-on: windows-latest')) {
    errors.push('Windows release workflow must run on windows-latest')
  }
  if (!activeWorkflow.includes('tauri-apps/tauri-action@v0') || !activeWorkflow.includes('--bundles nsis,msi')) {
    errors.push('Windows release workflow must retain NSIS and MSI bundling')
  }
  if (!activeWorkflow.includes('- name: Require version tag source') || !activeWorkflow.includes("github.ref_type != 'tag'")) {
    errors.push('Windows release workflow must reject branch-based manual dispatches')
  }
  const stageIndex = activeWorkflow.indexOf('- name: Stage portable Windows EXE')
  const uploadIndex = activeWorkflow.indexOf('- name: Upload portable Windows EXE')
  const verifyIndex = activeWorkflow.indexOf('- name: Verify portable Windows release asset')
  const publishIndex = activeWorkflow.indexOf('- name: Publish verified GitHub Release')
  if (stageIndex < 0 || !activeWorkflow.slice(stageIndex, uploadIndex > stageIndex ? uploadIndex : undefined).includes('node scripts/stage-windows-portable.mjs')) {
    errors.push('Windows release workflow must stage the portable EXE')
  }
  if (uploadIndex < 0 || !activeWorkflow.slice(uploadIndex, verifyIndex > uploadIndex ? verifyIndex : undefined).includes('gh release upload')) {
    errors.push('Windows release workflow must upload the staged portable EXE')
  }
  const verifyStep = verifyIndex < 0 ? '' : activeWorkflow.slice(verifyIndex, publishIndex > verifyIndex ? publishIndex : undefined)
  if (!verifyStep.includes('gh release view')
    || !verifyStep.includes('portableAsset.digest')
    || !verifyStep.includes('expectedDigest')
    || !verifyStep.includes('gh release download')
    || !verifyStep.includes('expectedChecksum')) {
    errors.push('Windows release workflow must verify uploaded portable bytes and checksum content')
  }
  if (!activeWorkflow.includes('releaseDraft: true')) {
    errors.push('Windows release workflow must keep the Release in draft until portable verification passes')
  }
  if (publishIndex < 0 || !activeWorkflow.slice(publishIndex).includes('gh release edit') || !activeWorkflow.slice(publishIndex).includes('--draft=false')) {
    errors.push('Windows release workflow must publish only after portable verification passes')
  }
  if ([stageIndex, uploadIndex, verifyIndex, publishIndex].every((index) => index >= 0)
    && !(stageIndex < uploadIndex && uploadIndex < verifyIndex && verifyIndex < publishIndex)) {
    errors.push('Windows release workflow must stage, upload, verify, then publish in that order')
  }
  return errors
}

export async function inspectReleaseConfig(root, mode) {
  if (mode !== 'template' && mode !== 'release') {
    throw new TypeError(`Unknown release check mode: ${mode}`)
  }

  const errors = []
  const warnings = []
  const summary = [`Release configuration mode: ${mode}`]
  const packageJson = parseJson(
    await readText(join(root, 'package.json'), errors, 'package.json'),
    errors,
    'package.json',
  )
  const cargoToml = await readText(join(root, 'src-tauri', 'Cargo.toml'), errors, 'src-tauri/Cargo.toml')
  const tauri = parseJson(
    await readText(join(root, 'src-tauri', 'tauri.conf.json'), errors, 'src-tauri/tauri.conf.json'),
    errors,
    'src-tauri/tauri.conf.json',
  )
  const packageVersion = packageJson?.version
  const cargoVersion = cargoToml?.match(versionPattern)?.[1]
  const tauriVersion = tauri?.version
  const versionsMatch = [packageVersion, cargoVersion, tauriVersion].every(
    (version) => typeof version === 'string' && version === packageVersion,
  )

  if (!versionsMatch) {
    errors.push(`Version mismatch: package.json=${packageVersion ?? 'missing'}, Cargo.toml=${cargoVersion ?? 'missing'}, tauri.conf.json=${tauriVersion ?? 'missing'}`)
  } else {
    summary.push(`Version: ${packageVersion}`)
  }

  if (typeof tauri?.identifier !== 'string' || tauri.identifier.trim() === '') {
    errors.push('Missing non-empty Tauri identifier')
  } else {
    summary.push(`Identifier: ${tauri.identifier}`)
  }

  const icons = tauri?.bundle?.icon
  if (!Array.isArray(icons) || icons.length === 0) {
    errors.push('Missing bundle icons')
  } else {
    for (const icon of icons) {
      if (typeof icon !== 'string' || icon.trim() === '') {
        errors.push('Invalid bundle icon path')
        continue
      }

      const iconPath = isAbsolute(icon) ? icon : join(root, 'src-tauri', icon)
      try {
        if (!(await stat(iconPath)).isFile()) {
          errors.push(`Invalid bundle icon: ${icon} (not a regular file)`)
        }
      } catch {
        errors.push(`Missing bundle icon: ${icon}`)
      }
    }
    summary.push(`Bundle icons: ${icons.length}`)
  }

  const endpoints = tauri?.plugins?.updater?.endpoints
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    errors.push('Missing updater endpoints')
  } else {
    for (const endpoint of endpoints) {
      let url
      try {
        url = new URL(endpoint)
      } catch {
        errors.push(`Invalid updater endpoint: ${endpoint}`)
        continue
      }

      if (url.protocol !== 'https:') {
        errors.push(`Updater endpoint must use HTTPS: ${endpoint}`)
        continue
      }

      if (isPlaceholderEndpoint(endpoint)) {
        const message = `placeholder updater endpoint: ${endpoint}`
        ;(mode === 'release' ? errors : warnings).push(message)
      }
    }
    summary.push(`Updater endpoints: ${endpoints.length}`)
  }

  const signingIssues = []
  if (typeof tauri?.plugins?.updater?.pubkey !== 'string' || tauri.plugins.updater.pubkey.trim() === '') {
    signingIssues.push('Missing non-empty updater public key at plugins.updater.pubkey')
  } else {
    summary.push('Updater public key: configured')
  }

  const updaterArtifacts = tauri?.bundle?.createUpdaterArtifacts
  if (updaterArtifacts !== true && updaterArtifacts !== 'v1Compatible') {
    signingIssues.push('bundle.createUpdaterArtifacts must enable updater artifacts (true or "v1Compatible")')
  } else {
    summary.push('Updater artifacts: enabled')
  }

  ;(mode === 'release' ? errors : warnings).push(...signingIssues)

  if (mode === 'release') {
    const releaseWorkflow = await readText(
      join(root, '.github', 'workflows', 'release.yml'),
      errors,
      '.github/workflows/release.yml',
    )
    const workflowErrors = validateWindowsReleaseWorkflow(releaseWorkflow)
    errors.push(...workflowErrors)
    if (workflowErrors.length === 0) summary.push('Portable Windows release asset: enforced')
  }

  return { errors, warnings, summary }
}
