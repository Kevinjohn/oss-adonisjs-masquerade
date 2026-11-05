import { test } from '@japa/runner'
import { selectRouteGuard } from '../src/integration/route_guard_selection.js'

const route = (guards: string[]) => ({
  middleware: { all: () => [{ name: 'auth', args: [{ guards }] }] },
})
const effective = Object.freeze({
  web_effective: 'web',
  support_effective: 'web',
  api_effective: 'api',
})

test('route selection resolves same-raw effective aliases and raw token controls', ({ assert }) => {
  assert.deepEqual(
    selectRouteGuard(route(['web_effective', 'support_effective']), 'web_effective', effective, [
      'web',
      'api',
    ]),
    { kind: 'effective', raw: 'web' }
  )
  assert.deepEqual(selectRouteGuard(route(['api']), 'web_effective', effective, ['web', 'api']), {
    kind: 'raw',
    raw: 'api',
  })
  assert.deepEqual(selectRouteGuard(undefined, 'web_effective', effective, ['web', 'api']), {
    kind: 'none',
    raw: 'web',
  })
})

test('route selection rejects mixed, ambiguous and unknown explicit guards', ({ assert }) => {
  for (const guards of [
    ['web_effective', 'api_effective'],
    ['web_effective', 'web'],
    ['web', 'api', 'web_effective'],
    ['unknown'],
  ]) {
    assert.throws(
      () => selectRouteGuard(route(guards), 'web_effective', effective, ['web', 'api']),
      'Masquerade is unavailable'
    )
  }
  assert.deepEqual(
    selectRouteGuard(route(['web', 'api']), 'web_effective', effective, ['web', 'api']),
    { kind: 'ambiguous' }
  )
})

test('an auth middleware that names no usable guard fails closed', ({ assert }) => {
  assert.throws(
    () => selectRouteGuard(route([]), 'web_effective', effective, ['web', 'api']),
    'Masquerade is unavailable'
  )
  const unnamed = { middleware: { all: () => [{ name: 'shield' }, () => {}] } }
  assert.deepEqual(selectRouteGuard(unnamed, 'web_effective', effective, ['web', 'api']), {
    kind: 'none',
    raw: 'web',
  })
})
