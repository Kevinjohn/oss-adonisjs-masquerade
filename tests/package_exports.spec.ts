import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'

if (process.env.TEST_BUILT_EXPORTS === '1') {
  test('loads every built public export', async ({ assert }) => {
    const root = await import('adonisjs-masquerade')
    const types = await import('adonisjs-masquerade/types')
    const provider = await import('adonisjs-masquerade/providers/masquerade_provider')
    const commands = await import('adonisjs-masquerade/commands')
    const auth = await import('adonisjs-masquerade/auth')
    const http = await import('adonisjs-masquerade/http')
    const native = await import('adonisjs-masquerade/native')
    const accountKitPath = 'adonisjs-masquerade/account-kit'
    const accountKitProviderPath = 'adonisjs-masquerade/account-kit/provider'
    const accountKitMiddlewarePath = 'adonisjs-masquerade/account-kit/middleware'
    const accountKit = await import(accountKitPath)
    const accountKitProvider = await import(accountKitProviderPath)
    const accountKitMiddleware = await import(accountKitMiddlewarePath)
    const lucid = await import('adonisjs-masquerade/stores/lucid')
    const testing = await import('adonisjs-masquerade/testing')
    const apiClientPlugin = await import('adonisjs-masquerade/plugins/api_client')
    assert.isFunction(apiClientPlugin.masqueradeApiClient)
    assert.equal(typeof root, 'object')
    assert.isFunction(root.configure)
    assert.isFunction(root.MasqueradeSetupError)
    assert.isString(root.stubsRoot)
    assert.isTrue(existsSync(join(root.stubsRoot, 'migrations/create_masquerade_tables.stub')))
    assert.lengthOf(Object.keys(types), 0)
    assert.isFunction(provider.default)
    assert.isFunction(auth.effectiveSessionGuard)
    assert.isFunction(auth.effectiveAccessTokensGuard)
    assert.isFunction(native.sessionAuthority)
    assert.isFunction(native.accessTokensAuthority)
    assert.isFunction(native.nativeAuthorities)
    assert.isFunction(native.stampFrom)
    assert.isFunction(accountKit.accountKitAuthority)
    assert.isFunction(accountKitProvider.default)
    assert.isFunction(accountKitMiddleware.default)
    for (const name of [
      'MasqueradeController',
      'masqueradeRoutes',
      'masqueradeContext',
      'renderMasqueradeError',
      'contextField',
      'shareMasquerade',
      'masqueradeAuditFields',
      'sensitive',
      'allowMutation',
    ] as const)
      assert.isFunction(http[name])
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
              if (/^@adonisjs\\//.test(specifier) || /account[-_]kit/i.test(specifier)) {
                throw new Error('Optional integration resolved: ' + specifier)
              }
              return nextResolve(specifier, context)
            },
          })
          const core = await import('adonisjs-masquerade')
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
              if (specifier === 'adonisjs-account-kit' || specifier.startsWith('adonisjs-account-kit/')) {
                throw new Error('Optional peer resolved eagerly: ' + specifier)
              }
              return nextResolve(specifier, context)
            },
          })
          const integration = await import('adonisjs-masquerade/account-kit')
          const provider = await import('adonisjs-masquerade/account-kit/provider')
          const middleware = await import('adonisjs-masquerade/account-kit/middleware')
          if (typeof integration.accountKitAuthority !== 'function' ||
              typeof provider.default !== 'function' || typeof middleware.default !== 'function') {
            throw new Error('Account Kit integration export is missing')
          }
        `,
      ],
      { encoding: 'utf8' }
    )
    assert.equal(consumer.status, 0, consumer.stderr)
  })
}
