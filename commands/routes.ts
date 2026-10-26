import { BaseCommand } from '@adonisjs/core/ace'
import { MasqueradeController } from '../http/controllers.js'
import type { MasqueradeConfig } from '../src/types.js'
import { routeGuards, routeMarkers } from '../integration/route_metadata.js'
import { effectiveFactoryRawGuard, isEffectiveFactory } from '../integration/guard_registration.js'
import { hasVerifiedAccountKitBlocker } from '../integration/account_kit_status.js'

/** Print a route coverage report from the router's committed route definitions. */
export default class RoutesCommand extends BaseCommand {
  static commandName = 'masquerade:routes'
  static description = 'Report masquerade route coverage and markers'
  static options = { startApp: true }

  async run(): Promise<void> {
    const config = this.app.config.get('masquerade') as
      MasqueradeConfig<unknown, object> | undefined
    if (!config) throw new TypeError('Masquerade configuration is required')
    const router = await this.app.container.make('router')
    const auth = await this.app.container.make('auth.manager')
    const effectiveGuardNames = Object.entries(auth.config.guards)
      .filter(([, factory]) => isEffectiveFactory(factory))
      .map(([name]) => name)
    const effectiveRawGuards: Record<string, string> = Object.create(null)
    for (const [name, factory] of Object.entries(auth.config.guards)) {
      const raw = effectiveFactoryRawGuard(factory)
      if (raw) effectiveRawGuards[name] = raw
    }
    router.commit()
    const domains = router.toJSON()
    for (const section of await routeCoverageReport(
      domains,
      config.authority.guard,
      String(auth.defaultGuard),
      effectiveGuardNames,
      effectiveRawGuards,
      hasVerifiedAccountKitBlocker(this.app)
    ))
      this.logger.info(section)
  }
}

export function routeCoverageReport(
  domains: Record<
    string,
    Array<{
      handler: unknown
      methods: string[]
      pattern: string
      name?: string
      middleware: { all(): Set<unknown> }
    }>
  >,
  rawGuard: string,
  effectiveGuardName = 'default guard',
  effectiveGuardNames: readonly string[] = [effectiveGuardName],
  effectiveRawGuards: Readonly<Record<string, string>> = {},
  verifiedAccountKitBlocker = false
): Promise<string[]> {
  const grouped = new Map<string, string[]>()
  const controllerCache = new Map<Function, Promise<ControllerResult>>()
  return (async () => {
    for (const [domain, routes] of Object.entries(domains)) {
      for (const route of routes) {
        if (route.name?.startsWith('accountKit.')) {
          const action = route.methods.some(
            (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method)
          )
            ? 'MUTATION'
            : 'READ'
          const exempt = ['accountKit.account.logout', 'accountKit.auth.csrf'].includes(route.name)
          const category =
            verifiedAccountKitBlocker && !exempt
              ? 'Account Kit managed (blocked while active)'
              : verifiedAccountKitBlocker
                ? 'Account Kit managed (exempt)'
                : 'UNCLASSIFIED'
          const note = verifiedAccountKitBlocker ? '' : ' (blocker missing or unverified)'
          const line = `  ${route.methods.join(',').padEnd(18)} ${route.pattern}${domain === 'root' ? '' : ` [${domain}]`} [${category} ${action}]${note}`
          const group = verifiedAccountKitBlocker ? 'Account Kit managed' : 'unprotected'
          grouped.set(group, [...(grouped.get(group) ?? []), line])
          continue
        }
        const guards = routeGuards(route, effectiveGuardName)
        const labels = guards.length ? guards : ['unprotected']
        const hasEffectiveGuard = guards.some((guard) => effectiveGuardNames.includes(guard))
        const hasOtherGuard = guards.some((guard) => !effectiveGuardNames.includes(guard))
        const mixedEffectiveGuards = hasEffectiveGuard && hasOtherGuard
        const distinctEffectiveTransports =
          new Set(
            guards
              .filter((guard) => effectiveGuardNames.includes(guard))
              .map((guard) =>
                Object.hasOwn(effectiveRawGuards, guard) ? effectiveRawGuards[guard] : undefined
              )
              .filter((raw): raw is string => Boolean(raw))
          ).size > 1
        const markers = routeMarkers({ route })
        const methods = route.methods.join(',')
        const packageControl = await isPackageControl(route.handler, controllerCache)
        const nameInferredControl = !packageControl.control && isHostControl(route.name)
        const effectiveGuardedControl = packageControl.control && hasEffectiveGuard
        for (const declaredGuard of labels) {
          const guard = declaredGuard
          const category =
            guard === 'unprotected'
              ? 'UNCLASSIFIED'
              : packageControl.control
                ? 'CONTROL'
                : nameInferredControl
                  ? 'POSSIBLE CONTROL'
                  : guard === rawGuard || !effectiveGuardNames.includes(guard)
                    ? 'RAW-GUARD BUSINESS'
                    : 'BUSINESS'
          const action = route.methods.some(
            (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method)
          )
            ? 'MUTATION'
            : 'READ'
          const flags = [
            markers.sensitive ? 'sensitive' : '',
            markers.allowMutation ? 'allowMutation' : '',
            nameInferredControl ? 'name-inferred; review handler' : '',
            packageControl.unresolved ? 'unresolved handler' : '',
            effectiveGuardedControl ? 'effective guard; controls must use raw guard' : '',
            mixedEffectiveGuards ? 'unsupported mixed effective/non-effective guards' : '',
            distinctEffectiveTransports
              ? 'unsupported distinct effective credential transports'
              : '',
          ]
            .filter(Boolean)
            .join(',')
          const line = `  ${methods.padEnd(18)} ${route.pattern}${domain === 'root' ? '' : ` [${domain}]`} [${category} ${action}]${flags ? ` (${flags})` : ''}`
          grouped.set(guard, [...(grouped.get(guard) ?? []), line])
        }
      }
    }
    return [...grouped]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([guard, lines]) => `${guard}\n${lines.join('\n')}`)
  })()
}

type ControllerResult = { control: boolean; unresolved: boolean }

async function isPackageControl(
  handler: unknown,
  cache: Map<Function, Promise<ControllerResult>>
): Promise<ControllerResult> {
  if (!handler || typeof handler !== 'object') return { control: false, unresolved: false }
  const registered = handler as { method?: unknown; reference?: unknown }
  const reference = registered.reference
  if (!['status', 'start', 'stop'].includes(String(registered.method)))
    return { control: false, unresolved: false }
  if (typeof reference === 'string') return { control: false, unresolved: true }
  if (!Array.isArray(reference)) return { control: false, unresolved: false }
  const lazyController = reference[0]
  if (typeof lazyController !== 'function') return { control: false, unresolved: true }
  if (isClassConstructor(lazyController))
    return {
      control:
        isMasqueradeController(lazyController) &&
        ['status', 'start', 'stop'].includes(String(registered.method)),
      unresolved: false,
    }
  let result = cache.get(lazyController)
  if (!result) {
    result = (async () => {
      try {
        const module = await lazyController()
        const controller =
          module && typeof module === 'object' && 'default' in module
            ? (module as { default?: unknown }).default
            : undefined
        return {
          control: isMasqueradeController(controller),
          unresolved: false,
        }
      } catch {
        return { control: false, unresolved: true }
      }
    })()
    cache.set(lazyController, result)
  }
  return result
}

function isClassConstructor(value: Function): boolean {
  return /^class\s/.test(Function.prototype.toString.call(value))
}

function isMasqueradeController(candidate: unknown): boolean {
  return (
    typeof candidate === 'function' &&
    (candidate === MasqueradeController ||
      Boolean(
        candidate.prototype && MasqueradeController.prototype.isPrototypeOf(candidate.prototype)
      ))
  )
}

function isHostControl(name: string | undefined): boolean {
  return new Set([
    'login',
    'signup',
    'register',
    'logout',
    'auth.login',
    'auth.signup',
    'auth.register',
    'auth.logout',
    'session.login',
    'session.logout',
  ]).has(name?.toLowerCase() ?? '')
}
