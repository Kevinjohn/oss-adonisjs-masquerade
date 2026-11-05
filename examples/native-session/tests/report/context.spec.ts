import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import MasqueradeContextMiddleware from '#middleware/masquerade_context_middleware'

const warnings: unknown[] = []

/** Record what the context middleware logs, without putting test code in the middleware. */
function captureWarnings(): () => void {
  const handle = MasqueradeContextMiddleware.prototype.handle
  MasqueradeContextMiddleware.prototype.handle = async function (ctx, next) {
    const warn = ctx.logger.warn.bind(ctx.logger)
    ctx.logger.warn = (...args: Parameters<typeof warn>) => {
      warnings.push(args[0])
      return warn(...args)
    }
    try {
      return await handle.call(this, ctx, next)
    } finally {
      ctx.logger.warn = warn
    }
  }
  return () => {
    MasqueradeContextMiddleware.prototype.handle = handle
    warnings.length = 0
  }
}

if (process.env.MASQUERADE_CONTEXT_ENFORCEMENT === 'report') {
  test.group('report-mode HTTP context rollout', (group) => {
    group.setup(() => testUtils.db().migrate())
    group.each.setup(() => captureWarnings())
    group.each.teardown(() => cleanUsers())

    test('logs a missing owner context and continues the idle business request', async ({
      client,
      assert,
    }) => {
      const { actor } = await createUsers()
      const response = await client
        .post('/business/report-probe')
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json({})
        .loginAs(actor)
      response.assertStatus(200)
      assert.equal(response.body().rawActorId, actor.id)
      response.assertHeader('cache-control', 'no-store')
      response.assertHeader('vary', 'Accept, X-Masquerade-Context')
      assert.deepEqual(warnings[0], {
        code: 'E_MASQUERADE_CONTEXT_REQUIRED',
        route: '/business/report-probe',
        actorId: String(actor.id),
      })
    })
  })
}
