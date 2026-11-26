import { errors } from '../index.ts'
import { test } from '@japa/runner'
import { commitTransition } from '../src/mode_transition.ts'
import { fixture } from './helpers/core.ts'
import type { CompareAndSetInput } from '../src/types.ts'

test('an applied outcome for another transition is an unknown commit, never applied', async ({
  assert,
}) => {
  const f = fixture()
  const input = { event: { id: 'expected' } } as CompareAndSetInput
  for (const outcome of [
    { status: 'applied', transitionId: 'other' },
    { status: 'indeterminate', transitionId: 'expected' },
    undefined,
  ]) {
    const store = { compareAndSet: async () => outcome } as never
    await assert.rejects(
      () => commitTransition(store, f.dependencies, input),
      errors.E_MASQUERADE_UNKNOWN_COMMIT as never
    )
  }
  assert.deepEqual(f.observed, [])
  const store = { compareAndSet: async () => ({ status: 'conflict' }) } as never
  assert.equal(await commitTransition(store, f.dependencies, input), 'conflict')
})
