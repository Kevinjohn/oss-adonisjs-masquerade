import { test } from '@japa/runner'
import { selectRouteGuard } from '../src/integration/route_guard_selection.ts'

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
    selectRouteGuard({
      route: route(['web_effective', 'support_effective']),
      defaultGuard: 'web_effective',
      effectiveRawGuards: effective,
      registeredRawGuards: ['web', 'api'],
    }),
    { kind: 'effective', raw: 'web' }
  )
  assert.deepEqual(
    selectRouteGuard({
      route: route(['api']),
      defaultGuard: 'web_effective',
      effectiveRawGuards: effective,
      registeredRawGuards: ['web', 'api'],
    }),
    {
      kind: 'raw',
      raw: 'api',
    }
  )
  assert.deepEqual(
    selectRouteGuard({
      route: undefined,
      defaultGuard: 'web_effective',
      effectiveRawGuards: effective,
      registeredRawGuards: ['web', 'api'],
    }),
    {
      kind: 'none',
      raw: 'web',
    }
  )
})

test('route selection rejects mixed, ambiguous and unknown explicit guards', ({ assert }) => {
  for (const guards of [
    ['web_effective', 'api_effective'],
    ['web_effective', 'web'],
    ['web', 'api', 'web_effective'],
    ['unknown'],
  ]) {
    assert.throws(
      () =>
        selectRouteGuard({
          route: route(guards),
          defaultGuard: 'web_effective',
          effectiveRawGuards: effective,
          registeredRawGuards: ['web', 'api'],
        }),
      'Masquerade is unavailable'
    )
  }
  assert.deepEqual(
    selectRouteGuard({
      route: route(['web', 'api']),
      defaultGuard: 'web_effective',
      effectiveRawGuards: effective,
      registeredRawGuards: ['web', 'api'],
    }),
    { kind: 'ambiguous' }
  )
})

test('an auth middleware that names no usable guard fails closed', ({ assert }) => {
  assert.throws(
    () =>
      selectRouteGuard({
        route: route([]),
        defaultGuard: 'web_effective',
        effectiveRawGuards: effective,
        registeredRawGuards: ['web', 'api'],
      }),
    'Masquerade is unavailable'
  )
  const unnamed = { middleware: { all: () => [{ name: 'shield' }, () => {}] } }
  assert.deepEqual(
    selectRouteGuard({
      route: unnamed,
      defaultGuard: 'web_effective',
      effectiveRawGuards: effective,
      registeredRawGuards: ['web', 'api'],
    }),
    {
      kind: 'none',
      raw: 'web',
    }
  )
})
