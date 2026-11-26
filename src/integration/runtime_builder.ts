import { MasqueradeCallbackRegistration } from '../callback_registration.ts'
import { NativeAdapter } from './native_adapter.ts'
import { debugLogger, reportObserverError } from '../debug.ts'
import { E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type {} from '@adonisjs/auth/auth_provider'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'
import { completeConfig, resolveMasqueradeConfig, validateConfig } from '../define_config.ts'
import type { CompleteMasqueradeConfig } from '../define_config.ts'
import { resolveCallbacks } from '../callback_registration.ts'
import { createMasqueradeService } from '../service.ts'
import { admitOnce } from '../request_admission.ts'
import { checkActiveMode } from '../active_mode.ts'
import { authenticateActorIdentity } from '../actor_identity.ts'
import type { RequestAdmission } from '../request_admission.ts'
import type { MasqueradePermissions, NativeAuthority, OwnerKey } from '../types.ts'
import type { NativeRuntimeAdapter } from '../types.ts'
import { MasqueradeRuntime } from './runtime.ts'
import { guardRegistration } from './guard_registration.ts'
import type { NativeGuardDriver } from './guard_registration.ts'
import { routeGuards } from './route_guards.ts'
import { selectRouteGuard } from './route_guard_selection.ts'

type TransitionName =
  'masquerade:started' | 'masquerade:stopped' | 'masquerade:expired' | 'masquerade:invalidated'
export interface RuntimeConfiguration {
  config: CompleteMasqueradeConfig<unknown, HttpContext>
  native: NativeRuntimeAdapter
  effectiveGuardName: string
  effectiveGuardNames: readonly string[]
  effectiveRawGuards: Readonly<Record<string, string>>
  effectiveDrivers: Readonly<Record<string, NativeGuardDriver>>
  registeredRawGuardNames: readonly string[]
  rawAdapters: Readonly<Record<string, NativeRuntimeAdapter>>
}
/** Validate native wiring without constructing the store or authenticating a request. */
export async function resolveRuntimeConfiguration(
  app: ApplicationService
): Promise<RuntimeConfiguration> {
  const configured = await resolveMasqueradeConfig<HttpContext>(app)
  const registry = await app.container.make(MasqueradeCallbackRegistration)
  const callbacks = await registry[resolveCallbacks]()
  const native = await app.container.make(NativeAdapter)
  if (callbacks?.native && callbacks.native !== native)
    throw new InvalidArgumentsException(
      'Masquerade native is supplied by both NativeAdapter and MasqueradeCallbackRegistration'
    )
  if (callbacks?.permissions && configured.permissions)
    throw new InvalidArgumentsException(
      'Masquerade permissions are supplied by both config/masquerade.ts and MasqueradeCallbackRegistration'
    )
  const config = completeConfig(
    validateConfig({
      ...configured,
      authority: configured.authority ?? (native?.authority as NativeAuthority<unknown>),
      permissions:
        configured.permissions ??
        (callbacks?.permissions as MasqueradePermissions<unknown, HttpContext>),
    })
  )
  if (
    !native ||
    typeof native.authenticateActor !== 'function' ||
    native.authority?.namespace !== config.authority.namespace ||
    native.authority.guard !== config.authority.guard
  )
    throw new InvalidArgumentsException(
      'Native masquerade binding must match configured namespace and guard'
    )
  const auth = await app.container.make('auth.manager')
  const primaryRaw = native.guard ?? native.authority.guard
  if (primaryRaw !== config.authority.guard)
    throw new InvalidArgumentsException(
      'Native masquerade binding must match configured namespace and guard'
    )
  const rawAdapters =
    native.adapters ??
    Object.freeze(
      Object.assign(Object.create(null), { [primaryRaw]: native }) as Record<
        string,
        NativeRuntimeAdapter
      >
    )
  if (!Object.hasOwn(rawAdapters, primaryRaw))
    throw new InvalidArgumentsException(
      'Native masquerade adapter map must include the primary guard'
    )
  for (const [guard, adapter] of Object.entries(rawAdapters)) {
    if (
      !guard ||
      !adapter ||
      adapter.authority !== native.authority ||
      (adapter.guard ?? adapter.authority.guard) !== guard ||
      typeof adapter.authenticateActor !== 'function'
    )
      throw new InvalidArgumentsException('Native masquerade adapter map is invalid')
    if (
      !Object.hasOwn(auth.config.guards, guard) ||
      typeof (auth.config.guards as Record<string, unknown>)[guard] !== 'function'
    )
      throw new InvalidArgumentsException(
        guard === primaryRaw
          ? 'The configured raw guard must be registered'
          : `The configured raw guard ${guard} must be registered`
      )
  }
  const effectiveGuardName = String(auth.defaultGuard)
  if (!guardRegistration.isEffectiveFactory(auth.config.guards[auth.defaultGuard]))
    throw new InvalidArgumentsException(
      'The default auth guard must be an effective masquerade guard'
    )
  const effectiveRawGuards: Record<string, string> = Object.create(null)
  const effectiveDrivers: Record<string, NativeGuardDriver> = Object.create(null)
  for (const [name, factory] of Object.entries(auth.config.guards)) {
    if (!guardRegistration.isEffectiveFactory(factory)) continue
    const raw = guardRegistration.getEffectiveFactoryRawGuard(factory)
    if (!raw || !Object.hasOwn(rawAdapters, raw))
      throw new InvalidArgumentsException(
        `Effective masquerade guard ${name} has no registered raw adapter`
      )
    effectiveRawGuards[name] = raw
    // Compare only registration metadata during boot. Factories require a live HttpContext.
    const effectiveDriver = guardRegistration.getEffectiveGuardDriver(factory)
    const rawDriver = rawAdapters[raw].driverName
    if (effectiveDriver && rawDriver && effectiveDriver !== rawDriver)
      throw new InvalidArgumentsException(
        `Effective masquerade guard ${name} wraps the ${effectiveDriver} driver, but the adapter registered for raw guard ${raw} declares the ${rawDriver} driver`
      )
    if (!effectiveDriver)
      throw new InvalidArgumentsException(
        `Effective masquerade guard ${name} has no native transport metadata`
      )
    effectiveDrivers[name] = effectiveDriver
  }
  const effectiveGuardNames = Object.freeze(
    Object.entries(auth.config.guards)
      .filter(([, factory]) => guardRegistration.isEffectiveFactory(factory))
      .map(([name]) => name)
  )
  const registeredRawGuardNames = Object.freeze(
    Object.entries(auth.config.guards)
      .filter(
        ([, factory]) =>
          typeof factory === 'function' && !guardRegistration.isEffectiveFactory(factory)
      )
      .map(([name]) => name)
  )
  return {
    config,
    native,
    effectiveGuardName,
    effectiveGuardNames,
    effectiveRawGuards: Object.freeze(effectiveRawGuards),
    effectiveDrivers: Object.freeze(effectiveDrivers),
    registeredRawGuardNames,
    rawAdapters,
  }
}
export async function createRuntime(
  app: ApplicationService,
  wiring: RuntimeConfiguration
): Promise<MasqueradeRuntime> {
  const emitter = await app.container.make('emitter')
  const selectGuard = (ctx: HttpContext) =>
    selectRouteGuard({
      route: ctx.route,
      defaultGuard: wiring.effectiveGuardName,
      effectiveRawGuards: wiring.effectiveRawGuards,
      registeredRawGuards: wiring.registeredRawGuardNames,
      primaryRawGuard: wiring.native.guard ?? wiring.native.authority.guard,
    })
  const service = await createMasqueradeService(wiring.config, {
    environment: app.nodeEnvironment,
    authenticateActor: (ctx) => {
      const selected = selectGuard(ctx)
      const adapter =
        selected.kind !== 'ambiguous' && Object.hasOwn(wiring.rawAdapters, selected.raw)
          ? wiring.rawAdapters[selected.raw]
          : undefined
      if (!adapter) throw new E_MASQUERADE_UNAVAILABLE()
      if (selected.kind === 'effective') {
        // The middleware can admit a request before named Auth runs. Construct the selected
        // facades with the real request now, and verify the actual raw guard before any store read.
        for (const name of routeGuards(ctx.route, wiring.effectiveGuardName)) {
          const driver = wiring.effectiveDrivers[name]
          if (!driver) throw new E_MASQUERADE_UNAVAILABLE()
          const rawGuard = wiring.effectiveRawGuards[name]
          for (const guard of [name, rawGuard]) {
            const fields = {
              code: 'E_MASQUERADE_UNAVAILABLE',
              component: 'guard_wiring',
              effectiveGuard: name,
              rawGuard,
              guard,
            }
            let actualDriver: unknown
            try {
              actualDriver = (ctx.auth.use(guard as never) as GuardContract<unknown>).driverName
            } catch (error) {
              ctx.logger?.error(
                { ...fields, error: error instanceof Error ? error.message : String(error) },
                'Masquerade could not construct a guard for the effective route'
              )
              throw new E_MASQUERADE_UNAVAILABLE()
            }
            if (actualDriver !== driver) {
              ctx.logger?.error(
                { ...fields, expectedDriver: driver, actualDriver },
                'Masquerade effective guard and its raw guard use different drivers'
              )
              throw new E_MASQUERADE_UNAVAILABLE()
            }
          }
        }
      }
      return adapter.authenticateActor(ctx)
    },
    emitter: { emit: (name, event) => emitter.emit(name as TransitionName, event) },
    logger: wiring.config.logger ?? debugLogger,
    // Native emitter.emit dispatches listener rejection to its registered onError handler.
    // A failed logger, missing handler or throwing handler reaches this safe diagnostic fallback.
    observerErrorHandler: reportObserverError,
  })
  return Object.freeze(new BootedMasqueradeRuntime(service as InternalService, wiring, selectGuard))
}

type InternalService = MasqueradeRuntime['service'] & {
  [admitOnce](ctx: HttpContext): Promise<RequestAdmission<unknown>>
  [checkActiveMode](owner: OwnerKey): Promise<boolean>
  [authenticateActorIdentity](ctx: HttpContext): Promise<{ id: string; incarnation: string }>
}

class BootedMasqueradeRuntime extends MasqueradeRuntime {
  #internal: InternalService
  #selectGuard: MasqueradeRuntime['selectGuard']

  declare readonly service: MasqueradeRuntime['service']
  declare readonly config: RuntimeConfiguration['config']
  declare readonly effectiveGuardName: string
  declare readonly effectiveGuardNames: readonly string[]

  constructor(
    service: InternalService,
    wiring: RuntimeConfiguration,
    selectGuard: MasqueradeRuntime['selectGuard']
  ) {
    super()
    this.service = service
    this.config = wiring.config
    this.effectiveGuardName = wiring.effectiveGuardName
    this.effectiveGuardNames = wiring.effectiveGuardNames
    this.#internal = service
    this.#selectGuard = selectGuard
  }

  selectGuard(ctx: HttpContext) {
    return this.#selectGuard(ctx)
  }

  admit(ctx: HttpContext) {
    return this.#internal[admitOnce](ctx)
  }

  activeMode(owner: OwnerKey) {
    return this.#internal[checkActiveMode](owner)
  }

  actor(ctx: HttpContext) {
    return this.#internal[authenticateActorIdentity](ctx)
  }
}
