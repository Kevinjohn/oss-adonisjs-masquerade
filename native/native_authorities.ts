import type { HttpContext } from '@adonisjs/core/http'
import type { NativeRuntimeAdapter } from '../integration/native_binding.js'
import { boundedString } from '../src/bounded_string.js'

/** The result of `nativeAuthorities`: the primary authority and one adapter per raw guard. */
export interface NativeAuthorityComposition<Primary extends NativeRuntimeAdapter> {
  readonly authority: Primary['authority']
  readonly guard?: string
  readonly adapters: Readonly<Record<string, NativeRuntimeAdapter>>
  authenticateActor: Primary['authenticateActor']
}

function adapterGuard(adapter: NativeRuntimeAdapter): string {
  if (!adapter || !adapter.authority || typeof adapter.authenticateActor !== 'function')
    throw new TypeError('Invalid native adapter guard')
  const guard = adapter.guard ?? adapter.authority.guard
  if (!boundedString(guard, 128)) throw new TypeError('Invalid native adapter guard')
  return guard
}

/** Compose native guards that share the exact same account authority. */
export function nativeAuthorities<Primary extends NativeRuntimeAdapter>(
  primary: Primary,
  additional: readonly NativeRuntimeAdapter[] = []
): NativeAuthorityComposition<Primary> {
  const adapters: Record<string, NativeRuntimeAdapter> = Object.create(null)
  const authority = primary?.authority
  if (
    !Array.isArray(additional) ||
    !authority ||
    !boundedString(authority.namespace, 128) ||
    !boundedString(authority.guard, 128)
  )
    throw new TypeError('Invalid native adapter guard')
  if (primary.adapters || additional.some((adapter) => adapter?.adapters))
    throw new TypeError('Native adapter compositions cannot be nested')

  for (const adapter of [primary, ...additional]) {
    const guard = adapterGuard(adapter)
    if (adapter !== primary && adapter.authority !== authority)
      throw new TypeError('Additional native adapters must share the primary authority')
    if (Object.hasOwn(adapters, guard))
      throw new TypeError('Native adapters must use unique guards')
    adapters[guard] = adapter
  }

  const composition: NativeAuthorityComposition<Primary> = {
    authority,
    ...(primary.guard === undefined ? {} : { guard: primary.guard }),
    adapters: Object.freeze(adapters),
    authenticateActor: (ctx: HttpContext) => primary.authenticateActor(ctx),
  }
  return Object.freeze(composition)
}
