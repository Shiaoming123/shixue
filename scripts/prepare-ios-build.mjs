import { readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeAppleDoubleFiles } from './release-kit/appledouble.mjs'

const simulatorOutputDirectories = {
  'aarch64-sim': 'arm64-sim',
  x86_64: 'x86_64',
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function prepareIosSimulatorBuild(root, target = 'aarch64-sim') {
  const outputDirectory = simulatorOutputDirectories[target]
  if (!outputDirectory) {
    throw new Error(`Unsupported iOS simulator target: ${target}`)
  }

  const tauriDirectory = join(root, 'src-tauri')
  const tauriConfig = JSON.parse(
    await readFile(join(tauriDirectory, 'tauri.conf.json'), 'utf8'),
  )
  const iosConfigPath = join(tauriDirectory, 'tauri.ios.conf.json')
  const iosConfig = await exists(iosConfigPath)
    ? JSON.parse(await readFile(iosConfigPath, 'utf8'))
    : {}
  const productName = iosConfig.productName ?? tauriConfig.productName
  if (typeof productName !== 'string' || !productName || basename(productName) !== productName) {
    throw new Error('Tauri config must contain a path-safe iOS productName')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(productName)) {
    throw new Error('iOS productName must use an ASCII native executable name')
  }

  const removedAppleDouble = await removeAppleDoubleFiles(root)
  const bundlePath = join(
    root,
    'src-tauri',
    'gen',
    'apple',
    'build',
    outputDirectory,
    `${productName}.app`,
  )
  const removedBundle = await exists(bundlePath)
  if (removedBundle) await rm(bundlePath, { recursive: true, force: true })

  return { bundlePath, removedBundle, removedAppleDouble }
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const target = process.argv[2] ?? 'aarch64-sim'
  const result = await prepareIosSimulatorBuild(root, target)
  console.log(`Removed ${result.removedAppleDouble.length} AppleDouble file(s).`)
  console.log(
    result.removedBundle
      ? `Removed stale iOS Simulator bundle: ${result.bundlePath}`
      : `No stale iOS Simulator bundle: ${result.bundlePath}`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
