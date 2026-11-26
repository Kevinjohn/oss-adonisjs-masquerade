import { test } from '@japa/runner'
import { delimiter, dirname } from 'node:path'
import {
  childDemoEnv,
  parseDemoEnv,
  validateDemoEnv,
} from '../bin/helpers/account_kit_demo_environment.ts'

test.group('Account Kit demo environment', () => {
  test('rejects unsafe effective configuration before any child starts', ({ assert }) => {
    const file = parseDemoEnv('HOST=127.0.0.1\nPORT=3398\nAPP_URL=http://${HOST}:${PORT}\n', '.env')
    assert.equal(validateDemoEnv(file, {}, 3398).APP_URL, 'http://127.0.0.1:3398')
    assert.throws(() => validateDemoEnv(file, { NODE_ENV: 'production' }, 3398), /NODE_ENV/)
    assert.throws(
      () => validateDemoEnv(file, { ACCOUNT_KIT_SECRET: 'hidden' }, 3398),
      /ACCOUNT_KIT_SECRET/
    )
    assert.throws(
      () => validateDemoEnv({ ...file, APP_URL: 'http://localhost:3398' }, {}, 3398),
      /APP_URL/
    )
    assert.throws(() => validateDemoEnv(file, { HOST: '0.0.0.0' }, 3398), /HOST/)
  })

  test('keeps Node 24 first on PATH after materialized and generated-key env refreshes', ({
    assert,
  }) => {
    const ambient = { PATH: '/other-node/bin:/usr/bin' }
    const file = { HOST: '127.0.0.1', PORT: '3398', APP_URL: 'http://127.0.0.1:3398' }
    const prospective = childDemoEnv(file, ambient, 3398)
    const materialized = childDemoEnv(file, ambient, 3398)
    Object.assign(prospective, materialized)
    const generated = childDemoEnv({ ...file, APP_KEY: 'generated' }, ambient, 3398)
    Object.assign(prospective, generated)
    assert.equal(
      prospective.PATH,
      `${dirname(process.execPath)}${delimiter}/other-node/bin:/usr/bin`
    )
    assert.equal(prospective.APP_KEY, 'generated')
  })
})
