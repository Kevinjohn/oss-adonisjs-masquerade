import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { approveUsers } from '#tests/helpers/account_kit_admission'
import {
  accountKitJson,
  accountKitRequest,
  cleanAccountKitUsers,
  createAccountKitUsers,
  loginAccountKitUser,
  masqueradePaths,
} from '#tests/helpers/account_kit_credentials'

const strategy =
  process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' ? 'access_tokens' : 'session'
const { control } = masqueradePaths()
const business = strategy === 'session' ? '/business' : '/api/business'
const sessionManagement = process.env.ACCOUNT_KIT_SESSION_MANAGEMENT === 'true'
const concurrency = 4
const requestsPerState = 8

/**
 * This bounded workload compares combined HTTP and Account Kit transaction costs. Its timings
 * describe this local fixture run; they are not a production capacity benchmark or an isolated
 * measurement of SQLite writer-lock time.
 */

type RequestSample = {
  elapsedMs: number
  successful: boolean
  status?: number
  effectiveId?: number
  error?: string
}

function percentile(sorted: number[], proportion: number) {
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)]
}

function summarize(samples: RequestSample[], wallMs: number, sql: string[]) {
  const latencies = samples.map((sample) => sample.elapsedMs).sort((left, right) => left - right)
  const successes = samples.filter((sample) => sample.successful).length
  const statements = sql.map((statement) => statement.trim().replace(/;\s*$/, ''))

  return {
    successes,
    failures: samples.length - successes,
    wallMs: Math.round(wallMs * 100) / 100,
    throughputPerSecond: Math.round((samples.length / (wallMs / 1000)) * 100) / 100,
    latencyMs: {
      min: latencies[0],
      median: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1),
    },
    sql: {
      begin: statements.filter((statement) => /^begin\b/i.test(statement)).length,
      commit: statements.filter((statement) => /^commit\b/i.test(statement)).length,
      writeQueries: statements.filter((statement) =>
        /^(insert|update|delete|replace)\b/i.test(statement)
      ).length,
    },
    samples,
  }
}

async function captureSql<T>(run: () => Promise<T>) {
  const client = db.connection().getWriteClient()
  const statements: string[] = []
  const listener = (query: { sql: string }) => statements.push(query.sql)
  client.on('query', listener)
  try {
    return { result: await run(), statements }
  } finally {
    client.removeListener('query', listener)
  }
}

test.group('packed Account Kit HTTP contention cost', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanAccountKitUsers())

  test('measures idle and active business requests at concurrency four', async ({ assert }) => {
    async function measureState(
      session: Awaited<ReturnType<typeof loginAccountKitUser>>,
      actorId: number,
      contextToken: string,
      expectedEffectiveId: number
    ) {
      let nextIndex = 0
      const samples = Array.from({ length: requestsPerState }, (): RequestSample => ({
        elapsedMs: 0,
        successful: false,
      }))
      const began = performance.now()

      const runWorker = async () => {
        while (true) {
          const index = nextIndex++
          if (index >= requestsPerState) return

          const requestBegan = performance.now()
          try {
            const response = await accountKitRequest(session.client, business, session.credential, {
              signal: AbortSignal.timeout(8_000),
              headers: { 'X-Masquerade-Context': contextToken },
            })
            const body = (await response.json()) as { actorId?: unknown; effectiveId?: unknown }
            const elapsedMs = Math.round((performance.now() - requestBegan) * 100) / 100
            const successful =
              response.status === 200 &&
              body.actorId === actorId &&
              body.effectiveId === expectedEffectiveId
            samples[index] = {
              elapsedMs,
              successful,
              status: response.status,
              ...(typeof body.effectiveId === 'number' ? { effectiveId: body.effectiveId } : {}),
            }
          } catch (error) {
            samples[index] = {
              elapsedMs: Math.round((performance.now() - requestBegan) * 100) / 100,
              successful: false,
              error: error instanceof Error ? error.name : 'unknown_error',
            }
          }
        }
      }

      const { statements } = await captureSql(() =>
        Promise.all(Array.from({ length: concurrency }, () => runWorker()))
      )
      return summarize(samples, performance.now() - began, statements)
    }

    let idle: ReturnType<typeof summarize> | null = null
    let active: ReturnType<typeof summarize> | null = null
    let setupFailure: string | undefined
    let actorId: number | undefined
    let targetId: number | undefined

    try {
      const users = await createAccountKitUsers()
      actorId = users.actor.id
      targetId = users.target.id
      await approveUsers(users.actor, users.target)

      const session = await loginAccountKitUser(users.actor.email)
      const idleStatus = await accountKitRequest(session.client, control, session.credential, {
        signal: AbortSignal.timeout(8_000),
      })
      if (idleStatus.status !== 200) throw new Error(`idle_status_http_${idleStatus.status}`)
      const idleContext = (await idleStatus.json()) as { contextToken: string }
      idle = await measureState(session, users.actor.id, idleContext.contextToken, users.actor.id)

      const started = await accountKitJson(
        session.client,
        `${control}/start`,
        session.credential,
        session.csrf,
        { targetId: users.target.id, reason: 'Account Kit contention measurement', access: 'edit' },
        { 'X-Masquerade-Context': idleContext.contextToken }
      )
      if (started.status !== 200) throw new Error(`mode_start_http_${started.status}`)
      const activeContext = (await started.json()) as {
        contextToken: string
        isMasquerading: boolean
        targetId: string | number
      }
      if (
        !activeContext.isMasquerading ||
        String(activeContext.targetId) !== String(users.target.id)
      )
        throw new Error('mode_start_identity_mismatch')
      active = await measureState(
        session,
        users.actor.id,
        activeContext.contextToken,
        users.target.id
      )
    } catch (error) {
      setupFailure = error instanceof Error ? error.message : 'unknown_setup_error'
    }

    console.log(
      `ACCOUNT_KIT_CONTENTION ${JSON.stringify({
        schema: 'account-kit-contention.v1',
        node: process.versions.node,
        database: process.env.DB_CLIENT,
        strategy,
        sessionManagement,
        endpoint: business,
        concurrency,
        requestsPerState,
        actorId,
        targetId,
        states: { idle, active },
        ...(setupFailure ? { setupFailure } : {}),
        measurement: 'combined_http_and_kit_transactions',
      })}`
    )

    assert.isTrue(setupFailure === undefined, setupFailure ?? 'measurement setup failed')
    assert.isNotNull(idle, 'idle workload should be measured')
    assert.isNotNull(active, 'active workload should be measured')
    for (const [state, summary] of [
      ['idle', idle],
      ['active', active],
    ] as const) {
      assert.equal(summary!.successes, requestsPerState, `${state} requests should succeed`)
      assert.equal(summary!.failures, 0, `${state} requests should not fail`)
      assert.isTrue(Number.isFinite(summary!.wallMs))
      assert.isAbove(summary!.wallMs, 0)
      assert.isTrue(Number.isFinite(summary!.throughputPerSecond))
      for (const latency of Object.values(summary!.latencyMs))
        assert.isTrue(Number.isFinite(latency))
      assert.isAbove(summary!.sql.begin, 0, `${state} SQL observer should capture BEGIN`)
      assert.isAbove(summary!.sql.commit, 0, `${state} SQL observer should capture COMMIT`)
      assert.isAbove(summary!.sql.writeQueries, 0, `${state} SQL observer should capture writes`)
    }
  })
    .timeout(60_000)
    .skip(
      process.env.DB_CLIENT === 'pg',
      'SQLite contention evidence only; PostgreSQL row-locking baseline is not measured here'
    )
})
