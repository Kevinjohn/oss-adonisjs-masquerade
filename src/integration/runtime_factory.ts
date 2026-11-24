import { E_MASQUERADE_UNAVAILABLE } from '../errors.js'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type {} from '@adonisjs/auth/auth_provider'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'
import { completeConfig, defineConfig } from '../define_config.js'
import type { CompleteMasqueradeConfig } from '../define_config.js'
import { resolveCallbacks } from '../callback_registry.js'
import { createMasqueradeService } from '../service.js'
import { admitOnce } from '../request_admission.js'
import { checkActiveMode } from '../active_mode.js'
import { authenticateActorIdentity } from '../actor_identity.js'
import type { RequestAdmission } from '../request_admission.js'
import type { MasqueradeConfig, MasqueradePolicy, NativeAuthority, OwnerKey } from '../types.js'
import type { NativeRuntimeAdapter } from './native_binding.js'
import type { MasqueradeRuntime } from './runtime.js'
import {
  getEffectiveGuardDriver,
  getEffectiveFactoryRawGuard,
  isEffectiveFactory,
} from './guard_registration.js'
import type { NativeGuardDriver } from './guard_registration.js'
import { routeGuards } from './route_guards.js'
import { selectRouteGuard } from './route_guard_selection.js'

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
  const configured = defineConfig(
    app.config.get<MasqueradeConfig<unknown, HttpContext>>('masquerade')
  )
  const registry = await app.container.make('masquerade.callbacks')
  const callbacks = await registry[resolveCallbacks]()
  const native = await app.container.make('masquerade.native')
  if (callbacks?.native && callbacks.native !== native)
    throw new InvalidArgumentsException(
      'Masquerade native is supplied by both masquerade.native and masquerade.callbacks'
    )
  if (callbacks?.policy && configured.policy)
    throw new InvalidArgumentsException(
      'Masquerade policy is supplied by both config/masquerade.ts and masquerade.callbacks'
    )
  const config = completeConfig(
    defineConfig({
      ...configured,
      authority: configured.authority ?? (native?.authority as NativeAuthority<unknown>),
      policy: configured.policy ?? (callbacks?.policy as MasqueradePolicy<unknown, HttpContext>),
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
  if (!isEffectiveFactory(auth.config.guards[auth.defaultGuard]))
    throw new InvalidArgumentsException(
      'The default auth guard must be an effective masquerade guard'
    )
  const effectiveRawGuards: Record<string, string> = Object.create(null)
  const effectiveDrivers: Record<string, NativeGuardDriver> = Object.create(null)
  for (const [name, factory] of Object.entries(auth.config.guards)) {
    if (!isEffectiveFactory(factory)) continue
    const raw = getEffectiveFactoryRawGuard(factory)
    if (!raw || !Object.hasOwn(rawAdapters, raw))
      throw new InvalidArgumentsException(
        `Effective masquerade guard ${name} has no registered raw adapter`
      )
    effectiveRawGuards[name] = raw
    // Compare only registration metadata during boot. Factories require a live HttpContext.
    const effectiveDriver = getEffectiveGuardDriver(factory)
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
      .filter(([, factory]) => isEffectiveFactory(factory))
      .map(([name]) => name)
  )
  const registeredRawGuardNames = Object.freeze(
    Object.entries(auth.config.guards)
      .filter(([, factory]) => typeof factory === 'function' && !isEffectiveFactory(factory))
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
  const logger = await app.container.make('logger')
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
    logger: {
      info: (event) => logger.info(event, 'Masquerade transition'),
      error: (event) => logger.error(event, 'Masquerade diagnostic'),
    },
    // Native emitter.emit dispatches listener rejection to its registered onError handler.
    // A failed logger, missing handler or throwing handler reaches this safe diagnostic fallback.
    observerErrorHandler: () =>
      logger.error({ code: 'E_MASQUERADE_OBSERVER_FAILED' }, 'Masquerade observer failed'),
  })
  const internal = service as typeof service & {
    [admitOnce](ctx: HttpContext): Promise<RequestAdmission<unknown>>
    [checkActiveMode](owner: OwnerKey): Promise<boolean>
    [authenticateActorIdentity](ctx: HttpContext): Promise<{ id: string; incarnation: string }>
  }
  return Object.freeze({
    service,
    config: wiring.config,
    effectiveGuardName: wiring.effectiveGuardName,
    effectiveGuardNames: wiring.effectiveGuardNames,
    selectGuard,
    admit: (ctx: HttpContext) => internal[admitOnce](ctx),
    activeMode: (owner: OwnerKey) => internal[checkActiveMode](owner),
    actor: (ctx: HttpContext) => internal[authenticateActorIdentity](ctx),
  })
}
