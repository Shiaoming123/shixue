import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deliveryFileName,
  hasWindowsBinaryHeader,
  readWindowsBuildMetadata,
  resolveCargoTargetRoot,
} from './package-windows.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

async function sha256(path) {
  const contents = await readFile(path)
  return createHash('sha256').update(contents).digest('hex')
}

export async function stageWindowsPortable({
  source,
  outputDirectory,
  version,
  architecture,
}) {
  const sourceContents = await readFile(source)
  if (!hasWindowsBinaryHeader(sourceContents, 'portable')) {
    throw new Error(`Portable source is not a valid PE executable: ${source}`)
  }

  await mkdir(outputDirectory, { recursive: true })
  const fileName = deliveryFileName('portable', version, architecture)
  const destination = resolve(outputDirectory, fileName)
  await copyFile(source, destination)
  const digest = await sha256(destination)
  const checksumPath = resolve(outputDirectory, `${fileName}.sha256`)
  await writeFile(checksumPath, `${digest}  ${fileName}\n`)
  return { path: destination, fileName, checksumPath, sha256: digest }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Portable Windows staging only runs on Windows.')
  const { binaryName, version } = await readWindowsBuildMetadata()
  const architecture = process.arch === 'x64' ? 'x64' : process.arch
  const outputDirectory = resolve(projectRoot, 'release-artifacts', 'github-release', 'windows', version)
  const result = await stageWindowsPortable({
    source: resolve(resolveCargoTargetRoot(), 'release', `${binaryName}.exe`),
    outputDirectory,
    version,
    architecture,
  })

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput) {
    await appendFile(githubOutput, [
      `tag=v${version}`,
      `portable_path=${result.path}`,
      `portable_name=${result.fileName}`,
      `checksum_path=${result.checksumPath}`,
      `checksum_name=${result.fileName}.sha256`,
      `sha256=${result.sha256}`,
      '',
    ].join('\n'))
  }
  console.log(`Portable Windows release staged: ${result.path}`)
  console.log(`SHA-256: ${result.sha256}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
