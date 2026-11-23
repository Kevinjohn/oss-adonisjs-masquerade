import { IgnitorFactory } from '@adonisjs/core/factories'
import { AuthManager, symbols } from '@adonisjs/auth'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { SessionUserProviderContract } from '@adonisjs/auth/types/session'
import { fixture } from './core.js'
import type { User } from './core.js'
import type { ControlStore } from '../../src/types.js'
import { sessionAuthority } from '../../native/main.js'
import type { NativeSessionAdapter } from '../../native/main.js'
import type { ApplicationService } from '@adonisjs/core/types'
import type { MasqueradeCallbackRegistry } from '../../src/callback_registry.js'
import { effectiveSessionGuard } from '../../auth/main.js'

export async function nativeRuntimeFixture(
  options: {
    store?: ControlStore
    missingRaw?: boolean
    rawDefault?: boolean
    aliases?: boolean
    unadaptedGuard?: string
    /** Leave authority, policy and the native binding to `masquerade.callbacks`. */
    callbacks?: boolean
    /** Called from an application provider's `boot()`, listed before the Masquerade provider. */
    register?: (registry: MasqueradeCallbackRegistry, native: NativeSessionAdapter<User>) => void
  } = {}
) {
  const f = fixture()
  const userProvider: SessionUserProviderContract<User> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as User,
    createUserForGuard: async (user) => ({ getId: () => user.id, getOriginal: () => user }),
    findById: async (id) => {
      const user = f.users.get(String(id))
      return user ? { getId: () => user.id, getOriginal: () => user } : null
    },
  }
  const native = sessionAuthority({
    namespace: 'test',
    guard: 'web',
    provider: userProvider,
    incarnation: (user) => user.incarnation,
    securityStamp: (user) => user.stamp,
    isActive: () => true,
  })
  let storeCreations = 0
  const config = {
    ...f.config,
    ...(options.callbacks
      ? { authority: undefined, policy: undefined }
      : { authority: native.authority }),
    store: async () => {
      storeCreations++
      return options.store ?? f.store
    },
  }
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      config: { masquerade: config },
      rcFileContents: {
        providers: [
          ...(options.register
            ? [
                async () => ({
                  default: class {
                    constructor(protected app: ApplicationService) {}
                    async boot() {
                      options.register?.(
                        await this.app.container.make('masquerade.callbacks'),
                        native
                      )
                    }
                  },
                }),
              ]
            : []),
          () => import('../../providers/masquerade_provider.js'),
        ],
      },
    })
    .create(new URL('../../', import.meta.url))
  const app = ignitor.createApp('web')
  await app.init()
  if (!options.callbacks) app.container.bindValue('masquerade.native', native)
  const raw = {
    resolver:
      async () =>
      (ctx: HttpContext): GuardContract<User> => {
        const guard: GuardContract<User> = {
          [symbols.GUARD_KNOWN_EVENTS]: undefined,
          driverName: 'session',
          user: undefined,
          authenticationAttempted: false,
          isAuthenticated: false,
          async authenticate() {
            guard.authenticationAttempted = true
            guard.user = f.users.get((ctx.request.input('actor') as string) ?? 'a')!
            guard.isAuthenticated = true
            return guard.user
          },
          async check() {
            await guard.authenticate()
            return true
          },
          getUserOrFail() {
            if (!guard.user) throw new Error('Not authenticated')
            return guard.user
          },
          authenticateAsClient: async (user: User) => ({ session: { userId: user.id } }),
        }
        return guard
      },
  }
  app.container.singleton('auth.manager', async () => {
    const effectiveFactory = await effectiveSessionGuard(raw).resolver('web_effective', app)
    const aliasFactory = options.aliases
      ? await effectiveSessionGuard(raw).resolver('support_effective', app)
      : undefined
    const rawFactory = await raw.resolver()
    return new AuthManager({
      default: options.rawDefault ? 'web' : 'web_effective',
      guards: {
        ...(options.missingRaw ? {} : { web: rawFactory }),
        ...(options.unadaptedGuard ? { [options.unadaptedGuard]: rawFactory } : {}),
        web_effective: effectiveFactory,
        ...(aliasFactory ? { support_effective: aliasFactory } : {}),
      },
    }) as never
  })
  return { ...f, app, native, config, storeCreations: () => storeCreations }
}
