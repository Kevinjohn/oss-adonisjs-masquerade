import { cleanUsers, createAccessToken, createUsers } from '#tests/helpers/users'
import User from '#models/user'
import {
  assertDemoEnvironmentAllowed,
  resetDemoAccounts,
  seedDemoAccounts,
} from '#services/demo_accounts'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const demoEmails = [
  'operator@example.test',
  'customer-one@example.test',
  'customer-two@example.test',
]

const usesPostgres = process.env.DB_CLIENT === 'pg'

test.group('demo accounts', (group) => {
  if (!usesPostgres) {
    group.setup(() => testUtils.db().migrate())
    group.each.teardown(async () => {
      await resetDemoAccounts({ nodeEnv: 'test', dbClient: 'sqlite' })
      await cleanUsers()
    })
  }

  test('seeds one operator and two customers idempotently without changing unrelated accounts', async ({
    assert,
  }) => {
    const unrelated = await createUsers()

    await seedDemoAccounts()
    await seedDemoAccounts()

    const demoUsers = await User.query().whereIn('email', demoEmails).orderBy('email')
    assert.lengthOf(demoUsers, 3)
    assert.deepEqual(
      demoUsers.map((user) => [
        user.email,
        Boolean(user.masqueradeOperator),
        Boolean(user.canMutate),
      ]),
      [
        ['customer-one@example.test', false, true],
        ['customer-two@example.test', false, true],
        ['operator@example.test', true, false],
      ]
    )
    assert.equal(
      await User.query()
        .count('* as total')
        .first()
        .then((row) => row?.$extras.total),
      5
    )
    assert.isNotNull(await User.find(unrelated.actor.id))
    const verifiedOperator = await User.verifyCredentials(
      'operator@example.test',
      'demo-operator-2026'
    )
    const seededOperator = await User.findByOrFail('email', 'operator@example.test')
    assert.equal(verifiedOperator.id, seededOperator.id)
  }).skip(usesPostgres, 'Demo account fixtures require SQLite')

  test('resets only the named demo accounts and their masquerade data', async ({ assert }) => {
    const { actor } = await createUsers()
    await seedDemoAccounts()
    const demoOperator = await User.findByOrFail('email', 'operator@example.test')
    const { token: demoToken } = await createAccessToken(demoOperator)
    const { token: unrelatedToken } = await createAccessToken(actor)
    await db.table('masquerade_modes').insert([idleMode(demoOperator.id), idleMode(actor.id)])
    await db
      .table('remember_me_tokens')
      .insert([rememberMeToken(demoOperator.id), rememberMeToken(actor.id)])
    await db
      .table('masquerade_events')
      .insert([masqueradeEvent(demoOperator.id), masqueradeEvent(actor.id)])

    await resetDemoAccounts({ nodeEnv: 'test', dbClient: 'sqlite' })

    assert.isNull(await User.findBy('email', 'operator@example.test'))
    assert.isNull(await User.findBy('email', 'customer-one@example.test'))
    assert.isNotNull(await User.find(actor.id))
    assert.equal(
      Number(
        await db
          .from('masquerade_modes')
          .where('actor_id', String(demoOperator.id))
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      0
    )
    assert.equal(
      Number(
        await db
          .from('masquerade_modes')
          .where('actor_id', String(actor.id))
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      1
    )
    assert.equal(
      Number(
        await db
          .from('remember_me_tokens')
          .where('tokenable_id', demoOperator.id)
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      0
    )
    assert.equal(
      Number(
        await db
          .from('remember_me_tokens')
          .where('tokenable_id', actor.id)
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      1
    )
    assert.equal(
      Number(
        await db
          .from('auth_access_tokens')
          .where('id', String(demoToken.identifier))
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      0
    )
    assert.equal(
      Number(
        await db
          .from('auth_access_tokens')
          .where('id', String(unrelatedToken.identifier))
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      1
    )
    assert.equal(
      Number(
        await db
          .from('masquerade_events')
          .where('actor_id', String(demoOperator.id))
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      0
    )
    assert.equal(
      Number(
        await db
          .from('masquerade_events')
          .where('actor_id', String(actor.id))
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      1
    )
  }).skip(usesPostgres, 'Demo account fixtures require SQLite')

  test('seeds through Ace after the app has started', async ({ assert }) => {
    assert.equal(runDemoCommand('demo:seed', 'development').exitCode, 0)
    assert.lengthOf(await User.query().whereIn('email', demoEmails), 3)

    assert.equal(runDemoCommand('demo:seed', 'development').exitCode, 0)
    assert.lengthOf(await User.query().whereIn('email', demoEmails), 3)
  }).skip(usesPostgres, 'Demo account fixtures require SQLite')

  test('prints one restricted native bearer credential only after validating seeded accounts', async ({
    assert,
  }) => {
    await seedDemoAccounts()
    const result = runDemoCommand('demo:token', 'development')
    assert.equal(result.exitCode, 0, result.output)
    const token = JSON.parse(result.stdout) as {
      token: string
      tokenId: string
      expiresAt: string
      operator: { id: string; email: string }
      customers: { id: string; email: string }[]
    }
    assert.deepEqual(Object.keys(token), ['token', 'tokenId', 'expiresAt', 'operator', 'customers'])
    assert.isString(token.token)
    assert.isNotEmpty(token.token)
    assert.isString(token.tokenId)
    assert.isTrue(Number.isFinite(Date.parse(token.expiresAt)))
    const operator = await User.findByOrFail('email', 'operator@example.test')
    assert.deepEqual(token.operator, {
      id: String(operator.id),
      email: 'operator@example.test',
    })
    assert.deepEqual(
      token.customers.map(({ email }) => email),
      ['customer-one@example.test', 'customer-two@example.test']
    )
    const customers = await User.query()
      .whereIn('email', ['customer-one@example.test', 'customer-two@example.test'])
      .orderBy('email')
    assert.deepEqual(
      token.customers.map(({ id }) => id),
      customers.map(({ id }) => String(id))
    )
    const issued = await db.from('auth_access_tokens').where('id', token.tokenId).first()
    assert.equal(issued?.name, 'local-support-demo')
    assert.equal(String(issued?.tokenable_id), token.operator.id)
    assert.deepEqual(JSON.parse(issued?.abilities ?? '[]'), ['masquerade'])
    assert.isNotNull(issued?.expires_at)
    assert.equal(new Date(issued.expires_at).toISOString(), token.expiresAt)
    assert.isAbove(Date.parse(token.expiresAt), Date.now())
    assert.isAtMost(Date.parse(token.expiresAt), Date.now() + 60 * 60 * 1000)
    const customerTokenCount = await db
      .from('auth_access_tokens')
      .whereIn(
        'tokenable_id',
        customers.map(({ id }) => id)
      )
      .count('* as total')
      .first()
    assert.equal(Number(customerTokenCount?.total), 0)

    const production = runDemoCommand('demo:token', 'production')
    assert.notEqual(production.exitCode, 0)
    assert.notInclude(production.stdout, '"token"')
    const postgres = runDemoCommand('demo:token', 'development', 'pg')
    assert.notEqual(postgres.exitCode, 0)
    assert.notInclude(postgres.stdout, '"token"')
  }).skip(usesPostgres, 'Demo account fixtures require SQLite')

  test('refuses token issuance before creating a token when demo accounts are missing or ineligible', async ({
    assert,
  }) => {
    await seedDemoAccounts()
    const customer = await User.findByOrFail('email', 'customer-two@example.test')
    await customer.delete()
    const noCustomers = runDemoCommand('demo:token', 'development')
    assert.notEqual(noCustomers.exitCode, 0)
    assert.notInclude(noCustomers.stdout, '"token"')
    assert.equal(
      Number(
        await db
          .from('auth_access_tokens')
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      0
    )

    await seedDemoAccounts()
    const operator = await User.findByOrFail('email', 'operator@example.test')
    operator.masqueradeOperator = false
    await operator.save()
    const ineligible = runDemoCommand('demo:token', 'development')
    assert.notEqual(ineligible.exitCode, 0)
    assert.notInclude(ineligible.stdout, '"token"')
    assert.equal(
      Number(
        await db
          .from('auth_access_tokens')
          .count('* as total')
          .first()
          .then((row) => row?.total)
      ),
      0
    )
  }).skip(usesPostgres, 'Demo account fixtures require SQLite')

  test('runs reset through Ace using NODE_ENV instead of the console execution environment', async ({
    assert,
  }) => {
    await seedDemoAccounts()
    assert.equal(runDemoCommand('demo:reset', 'development').exitCode, 0)
    assert.isNull(await User.findBy('email', 'operator@example.test'))

    await seedDemoAccounts()
    const productionReset = runDemoCommand('demo:reset', 'production')
    assert.notEqual(productionReset.exitCode, 0)
    assert.include(productionReset.output, 'Demo commands are allowed only in development or test')
    assert.isNotNull(await User.findBy('email', 'operator@example.test'))
  }).skip(usesPostgres, 'Demo account fixtures require SQLite')

  test('refuses reset in production or against PostgreSQL', ({ assert }) => {
    assert.throws(
      () => assertDemoEnvironmentAllowed({ nodeEnv: 'production', dbClient: 'sqlite' }),
      /development or test/
    )
    assert.throws(
      () => assertDemoEnvironmentAllowed({ nodeEnv: 'development', dbClient: 'pg' }),
      /local SQLite/
    )
  })
})

function runDemoCommand(
  command: 'demo:reset' | 'demo:seed' | 'demo:token',
  nodeEnv: 'development' | 'production',
  dbClient: 'sqlite' | 'pg' = 'sqlite'
): {
  exitCode: number
  stdout: string
  output: string
} {
  const appRoot = fileURLToPath(new URL('../../', import.meta.url))
  try {
    const output = execFileSync(process.execPath, ['ace', command], {
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
        PORT: '3333',
        HOST: 'localhost',
        LOG_LEVEL: 'error',
        APP_KEY: 'development-command-fixture-key-012345',
        APP_URL: 'http://localhost:3333',
        SESSION_DRIVER: 'memory',
        DB_CLIENT: dbClient,
        NATIVE_TEST_SQLITE: dbClient === 'sqlite' ? '1' : undefined,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { exitCode: 0, stdout: output, output }
  } catch (error) {
    const commandError = error as {
      status?: number
      stderr?: string | Buffer
      stdout?: string | Buffer
    }
    return {
      exitCode: commandError.status ?? 1,
      stdout: commandError.stdout?.toString() ?? '',
      output: `${commandError.stdout?.toString() ?? ''}${commandError.stderr?.toString() ?? ''}`,
    }
  }
}

function idleMode(actorId: number) {
  return {
    authority_namespace: 'native-session-fixture',
    actor_id: String(actorId),
    actor_incarnation: '1',
    revision: 1,
    revision_nonce: 'fixture-nonce',
    state: 'idle',
    mode_id: crypto.randomUUID(),
    last_transition_id: crypto.randomUUID(),
    target_id: null,
    target_incarnation: null,
    actor_stamp_hash: null,
    target_stamp_hash: null,
    reason: null,
    started_at: null,
    expires_at: null,
    updated_at: new Date().toISOString(),
  }
}

function rememberMeToken(tokenableId: number) {
  const timestamp = new Date()
  return {
    tokenable_id: tokenableId,
    hash: crypto.randomUUID(),
    created_at: timestamp,
    updated_at: timestamp,
    expires_at: new Date(timestamp.getTime() + 60_000),
  }
}

function masqueradeEvent(actorId: number) {
  return {
    id: crypto.randomUUID(),
    mode_id: null,
    authority_namespace: 'native-session-fixture',
    actor_id: String(actorId),
    actor_incarnation: '1',
    target_id: null,
    target_incarnation: null,
    at: new Date().toISOString(),
    kind: 'start_denied',
    outcome_code: 'E_MASQUERADE_DENIED',
    revision: 1,
    reason: null,
  }
}
