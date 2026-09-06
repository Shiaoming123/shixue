import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateApplicationProtocol } from '../scripts/check-app-protocol.mjs'
import { moduleContracts, moduleIds } from '../src/modules/contract.ts'
import { defaultModuleConfig } from '../src/modules/config.ts'
import { STUDY_EXPORT_FORMAT, STUDY_EXPORT_VERSION } from '../src/storage/study/data-port.ts'
import { WORKSPACE_EXPORT_FORMAT, WORKSPACE_EXPORT_VERSION } from '../src/storage/workspace/data-port.ts'

const packageJson = {
  name: 'meow-study',
  scripts: {
    test: 'node scripts/run-tests.mjs',
    typecheck: 'vue-tsc --noEmit',
    build: 'vite build',
    'build:web': 'vite build --mode web',
    'check:modules': 'node scripts/check-module-contract.mjs',
    'check:csp': 'node scripts/check-tauri-csp.mjs',
    'check:docs': 'node scripts/check-doc-links.mjs',
    'check:protocol': 'node scripts/check-app-protocol.mjs',
    'rust:verify': 'node scripts/rust-verify.mjs',
    'smoke:web-persistence': 'node scripts/smoke-web-persistence.mjs',
    'smoke:calendar': 'node scripts/smoke-calendar.mjs',
    'benchmark:task-query': 'node scripts/benchmark-study-task-query.mjs',
    'smoke:windows-package': 'node scripts/smoke-windows-package.mjs',
    'mobile:doctor': 'node scripts/mobile-doctor.mjs',
    'check:android-artifact': 'node scripts/check-android-artifact.mjs',
  },
}

const projectRoot = new URL('..', import.meta.url)

function validProtocol() {
  return {
    schemaVersion: 2,
    product: {
      name: 'meow-study',
      goal: 'Build a local-first cross-platform application.',
      scope: 'general-personal-planning',
      learningSpecialization: 'optional',
      nonGoals: ['No hosted sync by default.'],
    },
    targets: {
      primary: ['desktop'],
      maturity: { desktop: 'stable', web: 'beta', mobile: 'beta' },
      degradation: {
        web: ['Skip desktop-only modules.'],
        mobile: ['Skip desktop-only modules.'],
      },
    },
    modulePolicy: {
      enabled: moduleIds.filter((id) => defaultModuleConfig[id]),
      disabled: moduleIds.filter((id) => !defaultModuleConfig[id]),
    },
    data: {
      defaultMode: 'local-first',
      ports: [{ id: 'workspace', format: WORKSPACE_EXPORT_FORMAT, version: WORKSPACE_EXPORT_VERSION }],
      legacyInputs: [{ format: STUDY_EXPORT_FORMAT, versions: [1, STUDY_EXPORT_VERSION] }],
      sync: { enabled: false, provider: 'none' },
      recurrenceSchedule: {
        timed: 'scheduledAt', dateOnly: 'scheduledOn', mutuallyExclusive: true, dateOnlyMidnightEncoding: false,
      },
      exclusions: ['secrets', 'sync state'],
    },
    capabilities: {
      protocolVersion: 1,
      directStorageWrites: false,
      previewHandles: { persistence: 'none', scope: 'service-instance' },
      futureAgent: { status: 'planned', access: 'capability-service-only' },
    },
    implementation: {
      shippedFoundation: [
        'workspace-state-v3',
        'legacy-study-v1-v2-migration',
        'capability-protocol-v1',
        'live-write-capability-routing',
        'themed-control-foundation',
        'recurrence-occurrence-v1',
        'offline-natural-language-v1',
        'multi-reminder-v1',
        'calendar-planning-v1',
      ],
      shippedEvidence: [
        { id: 'navigation', sources: ['src/lib/workspace-view.ts'], tests: ['tests/workspace-navigation.test.ts'] },
        { id: 'today-upcoming', sources: ['src/domain/views/today.ts', 'src/domain/views/upcoming.ts'], tests: ['tests/workspace-projections.test.ts'] },
        { id: 'review-link', sources: ['src/domain/learning/review-task-link.ts'], tests: ['tests/review-task-link.test.ts'] },
        { id: 'responsive-shell', sources: ['src/lib/responsive-shell.ts'], tests: ['tests/responsive-shell.test.ts', 'tests/business-sheet-mount.test.ts'] },
      ],
      planned: ['agent-behavior'],
    },
    delivery: {
      desktopPackage: 'current-candidate-unverified',
      signing: 'unverified',
      updater: 'configured-unverified',
      webDeployment: 'unverified',
      mobileNative: 'unverified',
    },
    acceptance: {
      required: ['test', 'check:protocol', 'check:csp', 'typecheck', 'build', 'build:web', 'check:modules', 'check:docs'],
      conditional: ['rust:verify', 'smoke:web-persistence', 'smoke:calendar', 'benchmark:task-query', 'smoke:windows-package', 'mobile:doctor', 'check:android-artifact'],
    },
    evolution: {
      additive: 'Add fields in a new schema version.',
      breaking: 'Document migrations for removed promises.',
    },
  }
}

function validate(protocol: ReturnType<typeof validProtocol>, evidenceFileExists?: (path: string) => boolean) {
  return validateApplicationProtocol({
    protocol,
    packageJson,
    config: defaultModuleConfig,
    contracts: moduleContracts,
    moduleIds,
    evidenceFileExists,
  })
}

test('accepts a protocol that matches the product sources of truth', () => {
  assert.deepEqual(validate(validProtocol()).errors, [])
})

test('rejects missing module policy coverage before runtime loading can drift', () => {
  const protocol = validProtocol()
  protocol.modulePolicy.enabled = ['core']
  protocol.modulePolicy.disabled = []

  assert.match(validate(protocol).errors.join('\n'), /modulePolicy must cover every module exactly once/)
})

test('rejects a data-port version that would misstate the import boundary', () => {
  const protocol = validProtocol()
  protocol.data.ports[0].version = 2

  assert.match(validate(protocol).errors.join('\n'), /data\.ports\[workspace\] must match the exported Workspace data-port format and version/)
})

test('rejects a declared acceptance command that is not executable', () => {
  const protocol = validProtocol()
  protocol.acceptance.required.push('missing:command')

  assert.match(validate(protocol).errors.join('\n'), /acceptance\.required references missing package script "missing:command"/)
})

test('rejects a mobile delivery claim that does not match recorded local evidence', () => {
  const protocol = validProtocol()
  protocol.delivery.mobileNative = 'local-debug'

  assert.match(validate(protocol).errors.join('\n'), /delivery must retain the currently evidenced release boundary/)
})

test('rejects a protocol that omits the shipped calendar planning capability', () => {
  const protocol = validProtocol()
  protocol.implementation.shippedFoundation = protocol.implementation.shippedFoundation.filter((id) => id !== 'calendar-planning-v1')

  assert.match(validate(protocol).errors.join('\n'), /implementation\.shippedFoundation must include calendar-planning-v1/)
})

test('rejects missing or unverified shipped calendar planning evidence', () => {
  const protocol = validProtocol()
  protocol.implementation.shippedEvidence = protocol.implementation.shippedEvidence.filter(({ id }) => id !== 'review-link')

  assert.match(validate(protocol).errors.join('\n'), /implementation\.shippedEvidence must match navigation, today-upcoming, review-link, and responsive-shell evidence/)
})

test('rejects a protocol that drops calendar acceptance commands', () => {
  const protocol = validProtocol()
  protocol.acceptance.conditional = protocol.acceptance.conditional.filter((command) => command !== 'smoke:calendar')

  assert.match(validate(protocol).errors.join('\n'), /acceptance\.conditional must retain the calendar smoke and task-query benchmark commands/)
})

test('publishes the distinct calendar move and resize scope boundaries in both READMEs', () => {
  const chinese = readFileSync(new URL('README.md', projectRoot), 'utf8')
  const english = readFileSync(new URL('README.en.md', projectRoot), 'utf8')

  assert.match(chinese, /日历移动支持普通任务、单次发生项、未来发生项和整个系列；调整时长仅支持普通任务或单次发生项，未来\/系列范围会被明确拒绝。/)
  assert.match(english, /Calendar moves support a task, one occurrence, future occurrences, or the entire series\. Duration resizing supports only a task or one occurrence; future\/series resize scopes are explicitly rejected\./)
})

test('rejects equal-length duplicate replacements in declared protocol sets', () => {
  const protocol = validProtocol()
  protocol.implementation.shippedFoundation[protocol.implementation.shippedFoundation.length - 1] = protocol.implementation.shippedFoundation[0]

  assert.match(validate(protocol).errors.join('\n'), /implementation\.shippedFoundation/)
})

test('requires unique evidence ids, source paths, and test paths', () => {
  const duplicateId = validProtocol()
  duplicateId.implementation.shippedEvidence[1] = structuredClone(duplicateId.implementation.shippedEvidence[0])
  assert.match(validate(duplicateId).errors.join('\n'), /evidence ids must be unique/i)

  const duplicateSource = validProtocol()
  duplicateSource.implementation.shippedEvidence[1].sources[1] = duplicateSource.implementation.shippedEvidence[1].sources[0]
  assert.match(validate(duplicateSource).errors.join('\n'), /source paths must be unique/i)

  const duplicateTest = validProtocol()
  duplicateTest.implementation.shippedEvidence[3].tests[1] = duplicateTest.implementation.shippedEvidence[3].tests[0]
  assert.match(validate(duplicateTest).errors.join('\n'), /test paths must be unique/i)
})

test('rejects an evidence pointer whose declared file is missing', () => {
  const missingPath = 'tests/review-task-link.test.ts'
  const result = validate(validProtocol(), (path) => path !== missingPath)

  assert.match(result.errors.join('\n'), /tests\/review-task-link\.test\.ts does not exist/)
})

test('accepts only the current-candidate package and configured-unverified updater delivery states', () => {
  const protocol = validProtocol()
  assert.deepEqual(validate(protocol).errors, [])

  protocol.delivery.updater = 'template-only'
  assert.match(validate(protocol).errors.join('\n'), /delivery must retain the currently evidenced release boundary/)
})
