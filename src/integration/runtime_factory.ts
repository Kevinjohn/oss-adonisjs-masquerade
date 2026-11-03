import type {} from '@adonisjs/auth/auth_provider'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'
import { defineConfig } from '../define_config.js'
import { createMasqueradeService } from '../service.js'
import { admission } from '../request_admission.js'
import { activeMode } from '../active_mode.js'
import type { RequestAdmission } from '../request_admission.js'
import type { MasqueradeConfig, ObserverEvent } from '../types.js'
import type { OwnerKey } from '../types.js'
import type { NativeRuntimeAdapter } from './native_binding.js'
import type { MasqueradeRuntime } from './runtime.js'
import { effectiveFactoryRawGuard, isEffectiveFactory } from './guard_registration.js'
import { selectRouteGuard } from './route_guard_selection.js'
import { MasqueradeError } from '../errors.js'

type TransitionName =
  'masquerade:started' | 'masquerade:stopped' | 'masquerade:expired' | 'masquerade:invalidated'
declare module '@adonisjs/core/types' {
  interface EventsList {
    'masquerade:started': ObserverEvent
    'masquerade:stopped': ObserverEvent
    'masquerade:expired': ObserverEvent
    'masquerade:invalidated': ObserverEvent
  }
}
export interface RuntimeConfiguration {
  config: MasqueradeConfig<unknown, HttpContext>
  native: NativeRuntimeAdapter
  effectiveGuardName: string
  effectiveGuardNames: readonly string[]
  effectiveRawGuards: Readonly<Record<string, string>>
  registeredRawGuardNames: readonly string[]
  rawAdapters: Readonly<Record<string, NativeRuntimeAdapter>>
}
/** Validate native wiring without constructing the store or authenticating a request. */
export async function runtimeConfiguration(app: ApplicationService): Promise<RuntimeConfiguration> {
  const config = defineConfig(app.config.get<MasqueradeConfig<unknown, HttpContext>>('masquerade'))
  const native = await app.container.make('masquerade.native')
  if (
    !native ||
    typeof native.authenticateActor !== 'function' ||
    native.authority?.namespace !== config.authority.namespace ||
    native.authority.guard !== config.authority.guard
  )
    throw new TypeError('Native masquerade binding must match configured namespace and guard')
  const auth = await app.container.make('auth.manager')
  const primaryRaw = native.guard ?? native.authority.guard
  if (primaryRaw !== config.authority.guard)
    throw new TypeError('Native masquerade binding must match configured namespace and guard')
  const rawAdapters =
    native.adapters ??
    Object.freeze(
      Object.assign(Object.create(null), { [primaryRaw]: native }) as Record<
        string,
        NativeRuntimeAdapter
      >
    )
  if (!Object.hasOwn(rawAdapters, primaryRaw))
    throw new TypeError('Native masquerade adapter map must include the primary guard')
  for (const [guard, adapter] of Object.entries(rawAdapters)) {
    if (
      !guard ||
      !adapter ||
      adapter.authority !== native.authority ||
      (adapter.guard ?? adapter.authority.guard) !== guard ||
      typeof adapter.authenticateActor !== 'function'
    )
      throw new TypeError('Native masquerade adapter map is invalid')
    if (
      !Object.hasOwn(auth.config.guards, guard) ||
      typeof (auth.config.guards as Record<string, unknown>)[guard] !== 'function'
    )
      throw new TypeError(
        guard === primaryRaw
          ? 'The configured raw guard must be registered'
          : `The configured raw guard ${guard} must be registered`
      )
  }
  const effectiveGuardName = String(auth.defaultGuard)
  if (!isEffectiveFactory(auth.config.guards[auth.defaultGuard]))
    throw new TypeError('The default auth guard must be an effective masquerade guard')
  const effectiveRawGuards: Record<string, string> = Object.create(null)
  for (const [name, factory] of Object.entries(auth.config.guards)) {
    if (!isEffectiveFactory(factory)) continue
    const raw = effectiveFactoryRawGuard(factory)
    if (!raw || !Object.hasOwn(rawAdapters, raw))
      throw new TypeError(`Effective masquerade guard ${name} has no registered raw adapter`)
    effectiveRawGuards[name] = raw
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
    selectRouteGuard(
      ctx.route,
      wiring.effectiveGuardName,
      wiring.effectiveRawGuards,
      wiring.registeredRawGuardNames,
      wiring.native.guard ?? wiring.native.authority.guard
    )
  const service = await createMasqueradeService(wiring.config, {
    environment: app.nodeEnvironment,
    authenticateActor: (ctx) => {
      const selected = selectGuard(ctx)
      const adapter =
        selected.kind !== 'ambiguous' && Object.hasOwn(wiring.rawAdapters, selected.raw)
          ? wiring.rawAdapters[selected.raw]
          : undefined
      if (!adapter) throw new MasqueradeError('E_MASQUERADE_UNAVAILABLE')
      return adapter.authenticateActor(ctx)
    },
    emitter: { emit: (name, event) => emitter.emit(name as TransitionName, event) },
    logger: { info: (event) => logger.info(event), error: (event) => logger.error(event) },
    // Native emitter.emit dispatches listener rejection to its registered onError handler.
    // A failed logger, missing handler or throwing handler reaches this safe diagnostic fallback.
    observerErrorHandler: () => logger.error({ code: 'E_MASQUERADE_OBSERVER_FAILED' }),
  })
  const internal = service as typeof service & {
    [admission](ctx: HttpContext): Promise<RequestAdmission<unknown>>
    [activeMode](owner: OwnerKey): Promise<boolean>
  }
  return Object.freeze({
    service,
    config: wiring.config,
    effectiveGuardName: wiring.effectiveGuardName,
    effectiveGuardNames: wiring.effectiveGuardNames,
    selectGuard,
    admit: (ctx: HttpContext) => internal[admission](ctx),
    activeMode: (owner: OwnerKey) => internal[activeMode](owner),
  })
}
