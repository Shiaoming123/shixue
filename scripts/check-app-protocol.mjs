import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { moduleContracts, moduleIds } from '../src/modules/contract.ts'
import { defaultModuleConfig } from '../src/modules/config.ts'
import {
  STUDY_EXPORT_FORMAT,
  STUDY_EXPORT_VERSION,
} from '../src/storage/study/data-port.ts'
import {
  WORKSPACE_EXPORT_FORMAT,
  WORKSPACE_EXPORT_VERSION,
} from '../src/storage/workspace/data-port.ts'
import { CAPABILITY_PROTOCOL_VERSION } from '../src/domain/capabilities/types.ts'

const EXPECTED_MATURITY = { desktop: 'stable', web: 'beta', mobile: 'beta' }
const EXPECTED_DELIVERY = {
  desktopPackage: 'unverified',
  signing: 'unverified',
  updater: 'template-only',
  webDeployment: 'unverified',
  mobileNative: 'unverified',
}
const EXPECTED_NATIVE_EVIDENCE = {
  ios: {
    maturity: 'compile-ready',
    nativeBuild: 'pass',
    simulatorRun: 'fail',
    deviceRun: 'not-run',
  },
}
const EXPECTED_SHIPPED_FOUNDATION = [
  'workspace-state-v3',
  'legacy-study-v1-v2-migration',
  'capability-protocol-v1',
  'live-write-capability-routing',
  'themed-control-foundation',
  'recurrence-occurrence-v1',
  'offline-natural-language-v1',
  'multi-reminder-v1',
  'calendar-workspace-v1',
]
const EXPECTED_PLANNED_FEATURES = [
  'agent-behavior',
]

const IMPLEMENTATION_FACTS = {
  workspacePort: {
    id: 'workspace',
    format: WORKSPACE_EXPORT_FORMAT,
    version: WORKSPACE_EXPORT_VERSION,
  },
  legacyStudyInput: {
    format: STUDY_EXPORT_FORMAT,
    versions: [1, STUDY_EXPORT_VERSION],
  },
  capabilityProtocolVersion: CAPABILITY_PROTOCOL_VERSION,
}

export function validateApplicationProtocol({
  protocol,
  packageJson,
  config,
  contracts,
  moduleIds: expectedModuleIds,
  implementationFacts = IMPLEMENTATION_FACTS,
}) {
  const errors = []
  if (!isRecord(protocol)) return { errors: ['Protocol must be a JSON object.'] }

  if (protocol.schemaVersion !== 3) {
    errors.push('schemaVersion must be 3.')
  }

  validateProduct(protocol.product, packageJson, errors)
  validateTargets(protocol.targets, errors)
  validateModulePolicy(protocol.modulePolicy, config, contracts, expectedModuleIds, errors)
  validateDataBoundary(protocol.data, implementationFacts, errors)
  validateCapabilities(protocol.capabilities, implementationFacts, errors)
  validateImplementationStatus(protocol.implementation, errors)
  validateDelivery(protocol.delivery, errors)
  validateNativeEvidence(protocol.nativeEvidence, errors)
  validateAcceptance(protocol.acceptance, packageJson, errors)
  validateEvolution(protocol.evolution, errors)

  return { errors }
}

function validateProduct(product, packageJson, errors) {
  if (!isRecord(product)) {
    errors.push('product must be an object.')
    return
  }
  if (product.name !== packageJson?.name) {
    errors.push('product.name must match package.json name.')
  }
  if (!isNonEmptyString(product.goal)) errors.push('product.goal must be a non-empty string.')
  if (product.scope !== 'general-personal-planning') {
    errors.push('product.scope must declare general-personal-planning.')
  }
  if (product.learningSpecialization !== 'optional') {
    errors.push('product.learningSpecialization must remain optional.')
  }
  if (!isNonEmptyStringArray(product.nonGoals)) {
    errors.push('product.nonGoals must contain at least one non-empty string.')
  }
}

function validateTargets(targets, errors) {
  if (!isRecord(targets)) {
    errors.push('targets must be an object.')
    return
  }
  if (!Array.isArray(targets.primary) || !targets.primary.includes('desktop')) {
    errors.push('targets.primary must include desktop.')
  }
  if (!sameRecord(targets.maturity, EXPECTED_MATURITY)) {
    errors.push('targets.maturity must retain the documented desktop/web/mobile maturity levels.')
  }
  if (!isRecord(targets.degradation) || !isNonEmptyStringArray(targets.degradation.web) || !isNonEmptyStringArray(targets.degradation.mobile)) {
    errors.push('targets.degradation must describe non-empty Web and mobile fallback behaviour.')
  }
}

function validateModulePolicy(policy, config, contracts, expectedModuleIds, errors) {
  if (!isRecord(policy) || !Array.isArray(policy.enabled) || !Array.isArray(policy.disabled)) {
    errors.push('modulePolicy must contain enabled and disabled arrays.')
    return
  }

  const declared = [...policy.enabled, ...policy.disabled]
  if (!sameStrings(declared, expectedModuleIds) || new Set(declared).size !== declared.length) {
    errors.push('modulePolicy must cover every module exactly once.')
  }

  const expectedEnabled = expectedModuleIds.filter((id) => config[id] === true)
  const expectedDisabled = expectedModuleIds.filter((id) => config[id] !== true)
  if (!sameStrings(policy.enabled, expectedEnabled) || !sameStrings(policy.disabled, expectedDisabled)) {
    errors.push('modulePolicy must match defaultModuleConfig.')
  }

  for (const id of expectedModuleIds) {
    if (!contracts[id]) errors.push(`modulePolicy references module "${id}" without a module contract.`)
  }
}

function validateDataBoundary(data, implementationFacts, errors) {
  if (!isRecord(data)) {
    errors.push('data must be an object.')
    return
  }
  if (data.defaultMode !== 'local-first') errors.push('data.defaultMode must be local-first.')
  const workspacePort = implementationFacts.workspacePort
  if (!Array.isArray(data.ports) || data.ports.length !== 1 || !sameRecord(data.ports[0], workspacePort)) {
    errors.push(`data.ports[${workspacePort.id}] must match the exported Workspace data-port format and version.`)
  }
  const legacyInput = implementationFacts.legacyStudyInput
  if (!Array.isArray(data.legacyInputs) || data.legacyInputs.length !== 1 || !isRecord(data.legacyInputs[0]) || data.legacyInputs[0].format !== legacyInput.format || !sameNumbers(data.legacyInputs[0].versions, legacyInput.versions)) {
    errors.push('data.legacyInputs must match the exported Study format and supported v1/v2 migration inputs.')
  }
  if (!isRecord(data.sync) || data.sync.enabled !== false || data.sync.provider !== 'none') {
    errors.push('data.sync must keep provider none and enabled false by default.')
  }
  if (!isStringArray(data.exclusions) || !data.exclusions.includes('secrets') || !data.exclusions.includes('sync state')) {
    errors.push('data.exclusions must include secrets and sync state.')
  }
  if (!sameRecord(data.recurrenceSchedule, {
    timed: 'scheduledAt', dateOnly: 'scheduledOn', mutuallyExclusive: true, dateOnlyMidnightEncoding: false,
  })) {
    errors.push('data.recurrenceSchedule must preserve mutually exclusive timed/date-only fields without midnight encoding.')
  }
}

function validateCapabilities(capabilities, implementationFacts, errors) {
  if (!isRecord(capabilities)) {
    errors.push('capabilities must be an object.')
    return
  }
  if (capabilities.protocolVersion !== implementationFacts.capabilityProtocolVersion) {
    errors.push('capabilities.protocolVersion must match the exported capability protocol version.')
  }
  if (capabilities.directStorageWrites !== false) {
    errors.push('capabilities.directStorageWrites must be false.')
  }
  if (!sameRecord(capabilities.previewHandles, { persistence: 'none', scope: 'service-instance' })) {
    errors.push('capabilities.previewHandles must remain ephemeral and service-instance scoped.')
  }
  if (!isRecord(capabilities.futureAgent) || capabilities.futureAgent.status !== 'planned' || capabilities.futureAgent.access !== 'capability-service-only') {
    errors.push('capabilities.futureAgent must remain planned and capability-service-only.')
  }
}

function validateImplementationStatus(implementation, errors) {
  if (!isRecord(implementation)) {
    errors.push('implementation must be an object.')
    return
  }
  if (!sameStrings(implementation.shippedFoundation, EXPECTED_SHIPPED_FOUNDATION)) {
    errors.push('implementation.shippedFoundation must match the currently implemented planning foundation.')
  }
  if (!sameStrings(implementation.planned, EXPECTED_PLANNED_FEATURES)) {
    errors.push('implementation.planned must retain Agent behaviour as planned.')
  }
}

function validateDelivery(delivery, errors) {
  if (!sameRecord(delivery, EXPECTED_DELIVERY)) {
    errors.push('delivery must retain the currently evidenced release boundary.')
  }
}

function validateNativeEvidence(nativeEvidence, errors) {
  if (!sameRecord(nativeEvidence, EXPECTED_NATIVE_EVIDENCE)) {
    errors.push('nativeEvidence must retain the recorded iOS evidence boundary.')
  }
}

function validateAcceptance(acceptance, packageJson, errors) {
  if (!isRecord(acceptance) || !isStringArray(acceptance.required) || !isStringArray(acceptance.conditional)) {
    errors.push('acceptance must contain required and conditional command arrays.')
    return
  }
  for (const section of ['required', 'conditional']) {
    for (const command of acceptance[section]) {
      if (!packageJson?.scripts?.[command]) {
        errors.push(`acceptance.${section} references missing package script "${command}".`)
      }
    }
  }
}

function validateEvolution(evolution, errors) {
  if (!isRecord(evolution) || !isNonEmptyString(evolution.additive) || !isNonEmptyString(evolution.breaking)) {
    errors.push('evolution must describe additive and breaking changes.')
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isNonEmptyStringArray(value) {
  return isStringArray(value) && value.length > 0
}

function sameStrings(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value) => expected.includes(value))
}

function sameNumbers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value) => expected.includes(value))
}

function sameRecord(actual, expected) {
  return isRecord(actual) && JSON.stringify(actual) === JSON.stringify(expected)
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const protocol = readJson(resolve(root, 'app.protocol.json'))
  const packageJson = readJson(resolve(root, 'package.json'))
  const result = validateApplicationProtocol({
    protocol,
    packageJson,
    config: defaultModuleConfig,
    contracts: moduleContracts,
    moduleIds,
  })

  for (const error of result.errors) console.error(`ERROR ${error}`)
  if (result.errors.length > 0) process.exitCode = 1
  else console.log('Application protocol passed.')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
