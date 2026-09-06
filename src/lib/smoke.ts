import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './platform'

export type SmokePhase =
  | 'webview-created'
  | 'native-host-ready'
  | 'vue-mounted'
  | 'workspace-ready'
  | 'frontend-ready'

export async function reportSmokePhase(phase: SmokePhase): Promise<void> {
  console.info(`[shixue:smoke] ${phase}`)
  if (!isTauri()) return

  try {
    await invoke('report_ios_smoke_phase', { phase })
  } catch {
    // The smoke runner treats a missing marker as a failure. Normal app startup
    // must not fail when no smoke run id was supplied by the simulator launcher.
  }
}
