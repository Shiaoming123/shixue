import { execFile } from 'node:child_process'

export function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolveCommand) => {
    execFile(command, args, { encoding: 'utf8', ...options }, (error, stdout = '', stderr = '') => {
      resolveCommand({
        status: error?.code === undefined ? 0 : Number.isInteger(error.code) ? error.code : 1,
        stdout,
        stderr,
        signal: error?.signal ?? null,
      })
    })
  })
}

export function resultText(result) {
  return `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
}
