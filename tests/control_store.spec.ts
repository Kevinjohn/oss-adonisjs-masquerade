import { test } from '@japa/runner'
import { RuntimeException } from '@adonisjs/core/exceptions'
import { createMasqueradeService, errors } from '../index.js'
import { fixture } from './helpers/core.js'

test('reports an invalid store contract without exposing store values', async ({ assert }) => {
  const f = fixture()
  const config = {
    ...f.config,
    store: async () => ({ read: async () => null, privateValue: 'store-secret' }) as never,
  }
  let error: unknown

  try {
    await createMasqueradeService(config, f.dependencies)
  } catch (caught) {
    error = caught
  }

  assert.instanceOf(error, errors.E_MASQUERADE_STORE_METHOD_MISSING)
  assert.instanceOf(error, RuntimeException)
  assert.equal((error as { code?: string }).code, 'E_MASQUERADE_STORE_METHOD_MISSING')
  assert.equal((error as { field?: string }).field, 'store.compareAndSet')
  assert.equal((error as Error).message, 'The masquerade store lacks a required method')
  assert.notInclude(JSON.stringify(error), 'store-secret')
})
