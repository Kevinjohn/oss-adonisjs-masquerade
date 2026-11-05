import { test } from '@japa/runner'
import { validateTransition } from '../src/transition_validation.js'
import { validateControlOutcome } from '../src/control_outcome_validation.js'
import type { ActiveModeRow, CompareAndSetInput, ControlOutcomeEvent } from '../src/types.js'

const owner = { namespace: 'test', actorId: 'a', actorIncarnation: 'a' }
const at = '2026-01-01T00:00:00.000Z'
const active: ActiveModeRow = {
  ...owner,
  state: 'active',
  access: 'view',
  revision: 1,
  revisionNonce: 'a'.repeat(32),
  modeId: 'mode',
  lastTransitionId: 'event',
  updatedAt: at,
  targetId: 'b',
  targetIncarnation: 'b',
  actorStampHash: 'a'.repeat(64),
  targetStampHash: 'b'.repeat(64),
  reason: 'case',
  startedAt: at,
  expiresAt: '2026-01-01T00:15:00.000Z',
}
function start(): CompareAndSetInput {
  return {
    owner,
    expected: null,
    next: { ...active },
    event: {
      ...owner,
      id: 'event',
      modeId: 'mode',
      at,
      kind: 'started',
      outcomeCode: 'started',
      revision: 1,
      targetId: 'b',
      targetIncarnation: 'b',
      access: 'view',
      reason: 'case',
    },
  }
}

test('accepts a start whose event describes the committed row', ({ assert }) => {
  assert.doesNotThrow(() => validateTransition(start(), null))
})

for (const [name, change] of [
  [
    'skips a revision',
    (input: CompareAndSetInput) => (input.next.revision = input.event.revision = 2),
  ],
  [
    'keeps the expected revision',
    (input: CompareAndSetInput) => {
      input.expected = 1
      input.next.revision = input.event.revision = 1
    },
  ],
  [
    'records a stop kind for an active row',
    (input: CompareAndSetInput) => (input.event.kind = 'stopped'),
  ],
  [
    'records an event time other than the row update',
    (input: CompareAndSetInput) => (input.event.at = '2026-01-01T00:00:01.000Z'),
  ],
  ['records a different reason', (input: CompareAndSetInput) => (input.event.reason = 'other')],
  ['omits the reason', (input: CompareAndSetInput) => delete input.event.reason],
  [
    'records a different target incarnation',
    (input: CompareAndSetInput) => (input.event.targetIncarnation = 'c'),
  ],
  ['writes another namespace', (input: CompareAndSetInput) => (input.next.namespace = 'other')],
] as const)
  test(`rejects a transition that ${name}`, ({ assert }) => {
    const input = start()
    change(input)
    assert.throws(() => validateTransition(input, null), 'Masquerade is unavailable')
  })

test('control outcomes accept only outcome kinds', ({ assert }) => {
  const event = { ...owner, id: 'x', at, outcomeCode: 'idle', revision: 0 }
  for (const kind of ['start_denied', 'stop_denied', 'control_noop'] as const)
    assert.doesNotThrow(() => validateControlOutcome({ ...event, kind }))
  for (const kind of ['started', 'stopped', 'expired', 'invalidated', 'other'])
    assert.throws(
      () => validateControlOutcome({ ...event, kind } as unknown as ControlOutcomeEvent),
      'Masquerade is unavailable'
    )
})
