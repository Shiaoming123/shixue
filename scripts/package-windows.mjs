import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseRoot = resolve(projectRoot, 'release-artifacts', 'windows')
const tauriTarget = resolve(projectRoot, 'src-tauri', 'target', 'release')

export function assertDeliveryPath(root, candidate) {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (!resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Delivery path must stay inside ${resolvedRoot}: ${resolvedCandidate}`)
  }
  return resolvedCandidate
}

export function deliveryFileName(kind, version, arch = 'x64') {
  const suffixes = {
    nsis: 'Setup.exe',
    msi: 'Installer.msi',
    portable: 'Portable.exe',
  }
  const suffix = suffixes[kind]
  if (!suffix) throw new TypeError(`Unknown Windows delivery artifact kind: ${kind}`)
  return `Shixue_${version}_${arch}_${suffix}`
}

export function selectSingleArtifact(candidates, extension, version) {
  const matches = candidates.filter((candidate) => (
    candidate.toLowerCase().endsWith(extension.toLowerCase()) && basename(candidate).includes(version)
  ))
  if (matches.length !== 1) {
    throw new Error(`Expected one Windows ${extension} artifact for ${version}, found ${matches.length}.`)
  }
  return matches[0]
}

function runCommand(command, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', rejectCommand)
    child.once('exit', (code, signal) => {
      if (code === 0) return resolveCommand()
      rejectCommand(new Error(`${command} exited with ${signal ?? code}`))
    })
  })
}

async function listFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => resolve(directory, entry.name))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return []
    throw error
  }
}

async function sha256(path) {
  const contents = await readFile(path)
  return createHash('sha256').update(contents).digest('hex')
}

async function assertBinaryHeader(path, kind) {
  const contents = await readFile(path)
  const expected = kind === 'msi'
    ? Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    : Buffer.from('MZ')
  if (!contents.subarray(0, expected.length).equals(expected)) {
    throw new Error(`Invalid ${kind.toUpperCase()} binary header: ${path}`)
  }
}

export async function auditWindowsDelivery(directory) {
  const manifestPath = resolve(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.platform !== 'windows' || manifest.signing !== 'unsigned-local') {
    throw new Error('Windows delivery manifest has an unexpected platform or signing status.')
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3) {
    throw new Error('Windows delivery manifest must describe NSIS, MSI, and portable artifacts.')
  }

  const checksums = []
  for (const artifact of manifest.artifacts) {
    const artifactPath = assertDeliveryPath(directory, resolve(directory, artifact.file))
    const artifactStat = await stat(artifactPath)
    if (!artifactStat.isFile() || artifactStat.size !== artifact.bytes) {
      throw new Error(`Windows delivery artifact size mismatch: ${artifact.file}`)
    }
    const digest = await sha256(artifactPath)
    if (digest !== artifact.sha256) {
      throw new Error(`Windows delivery artifact checksum mismatch: ${artifact.file}`)
    }
    await assertBinaryHeader(artifactPath, artifact.kind)
    checksums.push(`${digest}  ${artifact.file}`)
  }

  const expectedChecksums = `${checksums.sort().join('\n')}\n`
  const actualChecksums = await readFile(resolve(directory, 'SHA256SUMS.txt'), 'utf8')
  if (actualChecksums !== expectedChecksums) {
    throw new Error('SHA256SUMS.txt does not match the delivery manifest.')
  }
  return manifest
}

async function readConfiguration() {
  const [packageJson, tauriConfig, cargoManifest] = await Promise.all([
    readFile(resolve(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8').then(JSON.parse),
    readFile(resolve(projectRoot, 'src-tauri', 'Cargo.toml'), 'utf8'),
  ])
  const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  const cargoPackageName = cargoManifest.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
  if (!cargoVersion || !cargoPackageName) throw new Error('Could not read Cargo package metadata.')
  if (new Set([packageJson.version, tauriConfig.version, cargoVersion]).size !== 1) {
    throw new Error('Package, Tauri, and Cargo versions must match before Windows packaging.')
  }
  if (!tauriConfig.productName?.trim() || !tauriConfig.identifier?.trim()) {
    throw new Error('Windows packaging requires a product name and identifier.')
  }
  return {
    cargoPackageName,
    identifier: tauriConfig.identifier,
    productName: tauriConfig.productName,
    version: packageJson.version,
  }
}

async function buildDelivery() {
  if (process.platform !== 'win32') throw new Error('Windows delivery packaging only runs on Windows.')
  const config = await readConfiguration()
  const architecture = process.arch === 'x64' ? 'x64' : process.arch
  const outputDirectory = assertDeliveryPath(releaseRoot, resolve(releaseRoot, config.version))

  await runCommand(process.execPath, [
    resolve(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
    'build',
    '--bundles',
    'nsis,msi',
    '--no-sign',
    '--ci',
    '--config',
    '{"bundle":{"createUpdaterArtifacts":false}}',
  ])

  const [nsisCandidates, msiCandidates] = await Promise.all([
    listFiles(resolve(tauriTarget, 'bundle', 'nsis')),
    listFiles(resolve(tauriTarget, 'bundle', 'msi')),
  ])
  const sources = {
    nsis: selectSingleArtifact(nsisCandidates, '-setup.exe', config.version),
    msi: selectSingleArtifact(msiCandidates, '.msi', config.version),
    portable: resolve(tauriTarget, `${config.cargoPackageName}.exe`),
  }
  const portableStat = await stat(sources.portable)
  if (!portableStat.isFile()) throw new Error(`Missing Tauri release executable: ${sources.portable}`)

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })

  const artifacts = []
  for (const kind of ['nsis', 'msi', 'portable']) {
    const file = deliveryFileName(kind, config.version, architecture)
    const destination = assertDeliveryPath(outputDirectory, resolve(outputDirectory, file))
    await copyFile(sources[kind], destination)
    const artifactStat = await stat(destination)
    artifacts.push({
      kind,
      file,
      bytes: artifactStat.size,
      sha256: await sha256(destination),
    })
  }

  const manifest = {
    schemaVersion: 1,
    productName: config.productName,
    packageName: config.cargoPackageName,
    identifier: config.identifier,
    version: config.version,
    platform: 'windows',
    architecture,
    signing: 'unsigned-local',
    artifacts,
  }
  await writeFile(resolve(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(
    resolve(outputDirectory, 'SHA256SUMS.txt'),
    `${artifacts.map(({ file, sha256: digest }) => `${digest}  ${file}`).sort().join('\n')}\n`,
  )
  await writeFile(
    resolve(outputDirectory, 'README.txt'),
    [
      `拾学 ${config.version} Windows 本地交付包`,
      '',
      '- Setup.exe: NSIS 当前用户安装包。',
      '- Installer.msi: Windows Installer 安装包。',
      '- Portable.exe: 免安装便携可执行文件。',
      '- SHA256SUMS.txt: 三个二进制文件的 SHA-256 校验值。',
      '- manifest.json: 产品标识、架构、签名状态和产物元数据。',
      '',
      '这些是本机生成的未签名包。首次运行可能出现 Windows SmartScreen 提示；公开分发前应使用可信代码签名证书签名。',
      '',
    ].join('\r\n'),
  )

  await auditWindowsDelivery(outputDirectory)
  console.log(`Windows delivery package passed audit: ${relative(projectRoot, outputDirectory)}`)
}

async function auditExistingDelivery() {
  const { version } = await readConfiguration()
  const outputDirectory = assertDeliveryPath(releaseRoot, resolve(releaseRoot, version))
  await auditWindowsDelivery(outputDirectory)
  console.log(`Windows delivery package passed audit: ${relative(projectRoot, outputDirectory)}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const action = process.argv.includes('--audit-only') ? auditExistingDelivery : buildDelivery
  action().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
