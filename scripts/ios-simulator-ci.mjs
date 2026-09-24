import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function selectIosSimulator(payload) {
  const candidates = Object.entries(payload?.devices ?? {})
    .flatMap(([runtime, devices]) => (Array.isArray(devices) ? devices : []).map((device) => ({ ...device, runtime })))
    .filter(({ isAvailable, name, udid }) => isAvailable && /^iPhone\b/.test(name) && typeof udid === 'string' && udid)
    .sort((left, right) => Number(right.state === 'Booted') - Number(left.state === 'Booted') || right.runtime.localeCompare(left.runtime, 'en', { numeric: true }) || left.name.localeCompare(right.name))
  const selected = candidates[0]
  if (!selected) throw new Error('No available iPhone Simulator was found.')
  return { name: selected.name, udid: selected.udid, runtime: selected.runtime }
}

export function buildIosCiEvidence({ sourceSha, simulator, appPath, launchReport }) {
  if (!/^[0-9a-f]{40}$/u.test(sourceSha)) throw new Error('sourceSha must be a full lowercase Git SHA.')
  if (!simulator?.udid || !simulator?.name || !simulator?.runtime) throw new Error('Simulator evidence must include name, runtime, and UDID.')
  if (!isAbsolute(appPath) || !appPath.endsWith('.app')) throw new Error('appPath must be an absolute .app path.')
  if (!launchReport?.success || launchReport.device !== simulator.udid || launchReport.app !== appPath) throw new Error('Launch report does not match the selected simulator and app.')
  const phases = ['nativeHostReady', 'webviewCreated', 'vueMounted', 'workspaceReady', 'frontendReady']
  if (!phases.every((phase) => launchReport.phases?.[phase] === true)) throw new Error('Launch report is missing required readiness phases.')
  return {
    schemaVersion: 1,
    sourceSha,
    simulator,
    appPath,
    launchEvidencePath: launchReport.evidencePath ?? null,
    phases: launchReport.phases,
    boundaries: {
      nativeBuild: 'pass', simulatorLaunch: 'pass', persistenceRestart: 'not-run',
      device: 'not-run', signing: 'not-run', distribution: 'not-run',
    },
  }
}

function args(argv) {
  const parsed = { command: argv[0] }
  for (let index = 1; index < argv.length; index += 2) parsed[argv[index].replace(/^--/u, '')] = argv[index + 1]
  return parsed
}

export async function main(argv = process.argv.slice(2)) {
  const options = args(argv)
  if (options.command === 'select') {
    const selected = selectIosSimulator(JSON.parse(await readFile(options.input, 'utf8')))
    await mkdir(resolve(options.output, '..'), { recursive: true })
    await writeFile(options.output, `${JSON.stringify(selected, null, 2)}\n`)
    if (options['github-output']) await appendFile(options['github-output'], `udid=${selected.udid}\nname=${selected.name}\nruntime=${selected.runtime}\n`)
    return selected
  }
  if (options.command === 'evidence') {
    const simulator = JSON.parse(await readFile(options.selection, 'utf8'))
    const launchReport = JSON.parse(await readFile(options['launch-report'], 'utf8'))
    const evidence = buildIosCiEvidence({ sourceSha: options['source-sha'], simulator, appPath: options.app, launchReport })
    await mkdir(resolve(options.output, '..'), { recursive: true })
    await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`)
    return evidence
  }
  throw new Error('Usage: ios-simulator-ci.mjs select|evidence <options>')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
