import { test } from '@japa/runner'
import {
  combineOperationFailure,
  throwIfOperationFailed,
} from '../../bin/helpers/operation_failures.js'

test('later cleanup appends after the original operation and its earlier cleanup', ({ assert }) => {
  const primary = new AggregateError([new Error('host subsystem')], 'host operation failed')
  const rollback = new Error('rollback failed')
  const release = new Error('release failed')
  const inner = combineOperationFailure(primary, [rollback], 'inner scope')
  const outer = combineOperationFailure(inner, [release], 'outer scope')

  assert.lengthOf(outer.errors, 3)
  assert.strictEqual(outer.errors[0], primary)
  assert.strictEqual(outer.errors[1], rollback)
  assert.strictEqual(outer.errors[2], release)
})

test('cleanup-only failures keep their observation order without an aggregate', ({ assert }) => {
  const failures = [new Error('first cleanup'), new Error('second cleanup')]
  let caught: unknown
  try {
    throwIfOperationFailed(undefined, failures, 'cleanup failed')
  } catch (error) {
    caught = error
  }
  assert.instanceOf(caught, Error)
  assert.notInstanceOf(caught, AggregateError)
  assert.strictEqual((caught as Error).cause, failures)
})
