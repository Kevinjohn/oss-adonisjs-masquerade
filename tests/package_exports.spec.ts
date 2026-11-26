import { rejects } from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'

if (process.env.TEST_BUILT_EXPORTS === '1') {
  test('loads every built public export', async ({ assert }) => {
    const root = await import('@kevinjohn/adonisjs-masquerade')
    const types = await import('@kevinjohn/adonisjs-masquerade/types')
    const provider = await import('@kevinjohn/adonisjs-masquerade/masquerade_provider')
    const retiredProviderPath = '@kevinjohn/adonisjs-masquerade/providers/masquerade_provider'
    await rejects(() => import(retiredProviderPath), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
    const commandsPath = '@kevinjohn/adonisjs-masquerade/commands'
    const commands: typeof import('./helpers/commands.ts') = await import(commandsPath)
    const auth = await import('@kevinjohn/adonisjs-masquerade/auth')
    const http = await import('@kevinjohn/adonisjs-masquerade/http')
    const contextMiddlewarePath = '@kevinjohn/adonisjs-masquerade/masquerade_context_middleware'
    const contextMiddleware = await import(contextMiddlewarePath)
    const native = await import('@kevinjohn/adonisjs-masquerade/native')
    const accountKitPath = '@kevinjohn/adonisjs-masquerade/account-kit'
    const accountKitProviderPath = '@kevinjohn/adonisjs-masquerade/account-kit/provider'
    const accountKitMiddlewarePath = '@kevinjohn/adonisjs-masquerade/account-kit/middleware'
    const accountKit = await import(accountKitPath)
    const accountKitProvider = await import(accountKitProviderPath)
    const accountKitMiddleware = await import(accountKitMiddlewarePath)
    const lucid = await import('@kevinjohn/adonisjs-masquerade/stores/lucid')
    const testing = await import('@kevinjohn/adonisjs-masquerade/testing')
    const apiClientPlugin = await import('@kevinjohn/adonisjs-masquerade/plugins/api_client')
    assert.isFunction(apiClientPlugin.masqueradeApiClient)
    assert.equal(typeof root, 'object')
    assert.isFunction(root.configure)
    assert.isFunction(root.MasqueradeCallbackRegistration)
    assert.isFunction(root.MasqueradeRuntime)
    assert.notProperty(root, 'MasqueradeError')
    assert.notProperty(root, 'MasqueradeSetupError')
    assert.deepEqual(Object.keys(root.errors).sort(), [
      'E_MASQUERADE_ACTION_BLOCKED',
      'E_MASQUERADE_ALREADY_ACTIVE',
      'E_MASQUERADE_CONTEXT_CHANGED',
      'E_MASQUERADE_CONTEXT_REQUIRED',
      'E_MASQUERADE_INVALID_CONFIGURATION',
      'E_MASQUERADE_INVALID_INPUT',
      'E_MASQUERADE_INVALID_STORE',
      'E_MASQUERADE_NOT_ALLOWED',
      'E_MASQUERADE_PRUNE_PROGRESS',
      'E_MASQUERADE_STOP_PROGRESS',
      'E_MASQUERADE_UNAUTHENTICATED',
      'E_MASQUERADE_UNAVAILABLE',
      'E_MASQUERADE_UNKNOWN_ACTOR_ACCOUNT',
      'E_MASQUERADE_UNKNOWN_COMMIT',
      'E_UNAUTHORIZED_ACCESS',
      'MasqueradeRequestException',
    ])
    const blocked = new root.errors.E_MASQUERADE_ACTION_BLOCKED('sensitive')
    assert.equal(blocked.code, 'E_MASQUERADE_ACTION_BLOCKED')
    assert.equal(blocked.blockedBy, 'sensitive')
    assert.isTrue(http.isMasqueradeRequestError(blocked))
    assert.isString(root.stubsRoot)
    assert.isTrue(existsSync(join(root.stubsRoot, 'make/migration/create_masquerade_tables.stub')))
    assert.lengthOf(Object.keys(types), 0)
    assert.isFunction(provider.default)
    assert.isFunction(auth.effectiveSessionGuard)
    assert.isFunction(auth.effectiveAccessTokensGuard)
    assert.isFunction(native.sessionAuthority)
    assert.isFunction(native.accessTokensAuthority)
    assert.isFunction(native.nativeAuthorities)
    assert.isFunction(native.stampFrom)
    assert.isFunction(lucid.createMasqueradeSchemaV1)
    assert.isFunction(lucid.dropMasqueradeSchemaV1)
    assert.equal(lucid.createMasqueradeSchema, lucid.createMasqueradeSchemaV1)
    assert.equal(lucid.dropMasqueradeSchema, lucid.dropMasqueradeSchemaV1)
    assert.isFunction(accountKit.accountKitAuthority)
    assert.isFunction(accountKitProvider.default)
    assert.isFunction(accountKitMiddleware.default)
    assert.isFunction(accountKitMiddleware.AccountKitAccountBlocker)
    assert.equal(http.default, http.MasqueradeContextMiddleware)
    assert.equal(contextMiddleware.default, http.MasqueradeContextMiddleware)
    for (const name of [
      'MasqueradeController',
      'masqueradeRoutes',
      'renderMasqueradeError',
      'contextField',
      'sensitive',
      'allowMutation',
    ] as const)
      assert.isFunction(http[name])
    assert.isFunction(http.masqueradeEdge.share)
    assert.isFunction(http.masqueradeAudit.fields)
    const commandMetadata = await commands.getMetaData()
    const prune = commandMetadata.find((command) => command.commandName === 'masquerade:prune')
    assert.isDefined(prune)
    assert.isFunction(await commands.getCommand(prune!))
    const routes = commandMetadata.find((command) => command.commandName === 'masquerade:routes')
    assert.isDefined(routes)
    assert.isFunction(await commands.getCommand(routes!))
    for (const subpath of [auth, http, native, lucid, testing])
      assert.equal(typeof subpath, 'object')
  })

  test('imports the core without resolving optional integrations', ({ assert }) => {
    const consumer = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import { registerHooks } from 'node:module'
          registerHooks({
            resolve(specifier, context, nextResolve) {
              if (['@adonisjs/lucid', '@adonisjs/assembler', '@adonisjs/bouncer', '@adonisjs/session', '@japa/api-client'].some((name) => specifier === name || specifier.startsWith(name + '/')) || /account[-_]kit/i.test(specifier)) {
                throw new Error('Optional integration resolved: ' + specifier)
              }
              return nextResolve(specifier, context)
            },
          })
          const core = await import('@kevinjohn/adonisjs-masquerade')
          if (typeof core.createMasqueradeService !== 'function') {
            throw new Error('Core service export is missing')
          }
        `,
      ],
      { encoding: 'utf8' }
    )
    assert.equal(consumer.status, 0, consumer.stderr)
  })

  test('imports Account Kit integration exports without resolving the optional peer', ({
    assert,
  }) => {
    const consumer = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import { registerHooks } from 'node:module'
          registerHooks({
            resolve(specifier, context, nextResolve) {
              if (specifier === '@kevinjohn/adonisjs-account-kit' || specifier.startsWith('@kevinjohn/adonisjs-account-kit/')) {
                throw new Error('Optional peer resolved eagerly: ' + specifier)
              }
              return nextResolve(specifier, context)
            },
          })
          const integration = await import('@kevinjohn/adonisjs-masquerade/account-kit')
          const provider = await import('@kevinjohn/adonisjs-masquerade/account-kit/provider')
          const middleware = await import('@kevinjohn/adonisjs-masquerade/account-kit/middleware')
          if (typeof integration.accountKitAuthority !== 'function' ||
              typeof provider.default !== 'function' || typeof middleware.default !== 'function' ||
              typeof middleware.AccountKitAccountBlocker !== 'function') {
            throw new Error('Account Kit integration export is missing')
          }
        `,
      ],
      { encoding: 'utf8' }
    )
    assert.equal(consumer.status, 0, consumer.stderr)
  })
}
