import { test } from '@japa/runner'
import { commitTransition, UnknownCommit } from '../src/mode_transition.js'
import { fixture } from './helpers/core.js'
import type { CompareAndSetInput } from '../src/types.js'

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
      UnknownCommit as never
    )
  }
  assert.deepEqual(f.observed, [])
  const store = { compareAndSet: async () => ({ status: 'conflict' }) } as never
  assert.equal(await commitTransition(store, f.dependencies, input), 'conflict')
})
