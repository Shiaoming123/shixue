import { readFileSync, statSync } from 'node:fs'
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
  desktopPackage: 'local-installed-acceptance',
  signing: 'unverified',
  updater: 'configured-unverified',
  webDeployment: 'unverified',
  mobileNative: 'unverified',
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
  'calendar-planning-v1',
]
const EXPECTED_PLANNED_FEATURES = [
  'agent-behavior',
]
const CALENDAR_ACCEPTANCE_COMMANDS = ['smoke:calendar', 'benchmark:task-query']
const EXPECTED_ACCEPTANCE = {
  required: ['test', 'check:protocol', 'check:csp', 'typecheck', 'build', 'build:web', 'check:modules', 'check:docs'],
  conditional: ['rust:verify', 'smoke:web-persistence', 'smoke:calendar', 'benchmark:task-query', 'smoke:windows-package', 'mobile:doctor', 'check:android-artifact'],
}
const EXPECTED_SHIPPED_EVIDENCE = [
  { id: 'navigation', sources: ['src/lib/workspace-view.ts'], tests: ['tests/workspace-navigation.test.ts'] },
  { id: 'today-upcoming', sources: ['src/domain/views/today.ts', 'src/domain/views/upcoming.ts'], tests: ['tests/workspace-projections.test.ts'] },
  { id: 'review-link', sources: ['src/domain/learning/review-task-link.ts'], tests: ['tests/review-task-link.test.ts'] },
  { id: 'responsive-shell', sources: ['src/lib/responsive-shell.ts'], tests: ['tests/responsive-shell.test.ts', 'tests/business-sheet-mount.test.ts'] },
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
  evidenceFileExists = () => true,
}) {
  const errors = []
  if (!isRecord(protocol)) return { errors: ['Protocol must be a JSON object.'] }

  if (protocol.schemaVersion !== 2) {
    errors.push('schemaVersion must be 2.')
  }

  validateProduct(protocol.product, packageJson, errors)
  validateTargets(protocol.targets, errors)
  validateModulePolicy(protocol.modulePolicy, config, contracts, expectedModuleIds, errors)
  validateDataBoundary(protocol.data, implementationFacts, errors)
  validateCapabilities(protocol.capabilities, implementationFacts, errors)
  validateImplementationStatus(protocol.implementation, evidenceFileExists, errors)
  validateDelivery(protocol.delivery, errors)
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
  if (!isUniqueNonEmptyStringArray(product.nonGoals)) {
    errors.push('product.nonGoals must contain at least one non-empty string.')
  }
}

function validateTargets(targets, errors) {
  if (!isRecord(targets)) {
    errors.push('targets must be an object.')
    return
  }
  if (!sameStrings(targets.primary, ['desktop'])) {
    errors.push('targets.primary must contain desktop exactly once.')
  }
  if (!sameRecord(targets.maturity, EXPECTED_MATURITY)) {
    errors.push('targets.maturity must retain the documented desktop/web/mobile maturity levels.')
  }
  if (!isRecord(targets.degradation) || !isUniqueNonEmptyStringArray(targets.degradation.web) || !isUniqueNonEmptyStringArray(targets.degradation.mobile)) {
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
  if (!sameStrings(data.exclusions, ['secrets', 'sync state'])) {
    errors.push('data.exclusions must contain secrets and sync state exactly once.')
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

function validateImplementationStatus(implementation, evidenceFileExists, errors) {
  if (!isRecord(implementation)) {
    errors.push('implementation must be an object.')
    return
  }
  if (!sameStrings(implementation.shippedFoundation, EXPECTED_SHIPPED_FOUNDATION)) {
    errors.push('implementation.shippedFoundation must include calendar-planning-v1 and match the currently implemented planning foundation.')
  }
  validateEvidenceUniquenessAndFiles(implementation.shippedEvidence, evidenceFileExists, errors)
  if (!sameShippedEvidence(implementation.shippedEvidence, EXPECTED_SHIPPED_EVIDENCE)) {
    errors.push('implementation.shippedEvidence must match navigation, today-upcoming, review-link, and responsive-shell evidence.')
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
  if (!sameStrings(acceptance.required, EXPECTED_ACCEPTANCE.required)
    || !sameStrings(acceptance.conditional, EXPECTED_ACCEPTANCE.conditional)) {
    errors.push('acceptance command sets must match the required and conditional release gates exactly once.')
  }
  if (!CALENDAR_ACCEPTANCE_COMMANDS.every((command) => acceptance.conditional.includes(command))) {
    errors.push('acceptance.conditional must retain the calendar smoke and task-query benchmark commands.')
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

function isUniqueNonEmptyStringArray(value) {
  return isNonEmptyStringArray(value) && new Set(value).size === value.length
}

function sameStrings(actual, expected) {
  return isStringArray(actual)
    && new Set(actual).size === actual.length
    && actual.length === expected.length
    && actual.every((value) => expected.includes(value))
    && expected.every((value) => actual.includes(value))
}

function sameNumbers(actual, expected) {
  return Array.isArray(actual)
    && actual.every((value) => typeof value === 'number')
    && new Set(actual).size === actual.length
    && actual.length === expected.length
    && actual.every((value) => expected.includes(value))
    && expected.every((value) => actual.includes(value))
}

function validateEvidenceUniquenessAndFiles(actual, evidenceFileExists, errors) {
  if (!Array.isArray(actual)) return
  const ids = []
  const sourcePaths = []
  const testPaths = []
  for (const entry of actual) {
    if (!isRecord(entry)) continue
    if (isNonEmptyString(entry.id)) ids.push(entry.id)
    if (isStringArray(entry.sources)) sourcePaths.push(...entry.sources)
    if (isStringArray(entry.tests)) testPaths.push(...entry.tests)
  }
  if (new Set(ids).size !== ids.length) errors.push('implementation.shippedEvidence evidence ids must be unique.')
  if (new Set(sourcePaths).size !== sourcePaths.length) errors.push('implementation.shippedEvidence source paths must be unique.')
  if (new Set(testPaths).size !== testPaths.length) errors.push('implementation.shippedEvidence test paths must be unique.')
  for (const path of [...sourcePaths, ...testPaths]) {
    if (!evidenceFileExists(path)) errors.push(`implementation.shippedEvidence file ${path} does not exist.`)
  }
}

function sameShippedEvidence(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false
  if (new Set(actual.map((entry) => isRecord(entry) ? entry.id : undefined)).size !== actual.length) return false
  return expected.every((expectedEntry) => {
    const entry = actual.find((candidate) => isRecord(candidate) && candidate.id === expectedEntry.id)
    return isRecord(entry) && sameStrings(entry.sources, expectedEntry.sources) && sameStrings(entry.tests, expectedEntry.tests)
  })
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
    evidenceFileExists: (path) => {
      try {
        return statSync(resolve(root, path)).isFile()
      } catch {
        return false
      }
    },
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
