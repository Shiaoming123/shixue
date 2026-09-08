import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultProjectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const validIdentifier = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/

export function readMobileAppIdentity(projectRoot = defaultProjectRoot) {
  let config
  try {
    config = JSON.parse(readFileSync(resolve(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  } catch (error) {
    throw new Error('Could not read the Tauri app identifier.', { cause: error })
  }

  const identifier = config?.identifier
  if (
    typeof identifier !== 'string' ||
    identifier.length > 255 ||
    !validIdentifier.test(identifier)
  ) {
    throw new Error('Tauri config must define a valid identifier for mobile smoke tests.')
  }

  return {
    identifier,
    androidPackageId: identifier.replaceAll('-', '_'),
  }
}

export const MOBILE_APP_IDENTITY = readMobileAppIdentity()
