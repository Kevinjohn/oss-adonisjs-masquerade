import type { NativeAuthorityComposition } from '../types.ts'
import type { HttpContext } from '@adonisjs/core/http'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { NativeRuntimeAdapter } from '../types.ts'
import { isBoundedString } from '../bounded_string.ts'

function requireAdapterGuard(adapter: NativeRuntimeAdapter): string {
  if (!adapter || !adapter.authority || typeof adapter.authenticateActor !== 'function')
    throw new InvalidArgumentsException('Invalid native adapter guard')
  const guard = adapter.guard ?? adapter.authority.guard
  if (!isBoundedString(guard, 128))
    throw new InvalidArgumentsException('Invalid native adapter guard')
  return guard
}

/**
 * Compose native guards that share the exact same account authority.
 *
 * @example
 * ```ts
 * * import { accessTokensAuthority, nativeAuthorities } from '@kevinjohn/adonisjs-masquerade/native'
 * import type { NativeSessionAdapter } from '@kevinjohn/adonisjs-masquerade/types'
 * import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
 *
 * type Account = { id: string }
 * export function supportNative(
 *   web: NativeSessionAdapter<Account>,
 *   provider: AccessTokensUserProviderContract<Account>
 * ) {
 *   const api = accessTokensAuthority({
 *     guard: 'api',
 *     provider,
 *     ability: 'support:masquerade',
 *     authority: web.authority,
 *   })
 *   return nativeAuthorities(web, [api])
 * }
 * ```
 */
export function nativeAuthorities<Primary extends NativeRuntimeAdapter>(
  primary: Primary,
  additional: readonly NativeRuntimeAdapter[] = []
): NativeAuthorityComposition<Primary> {
  const adapters: Record<string, NativeRuntimeAdapter> = Object.create(null)
  const authority = primary?.authority
  if (
    !Array.isArray(additional) ||
    !authority ||
    !isBoundedString(authority.namespace, 128) ||
    !isBoundedString(authority.guard, 128)
  )
    throw new InvalidArgumentsException('Invalid native adapter guard')
  if (primary.adapters || additional.some((adapter) => adapter?.adapters))
    throw new InvalidArgumentsException('Native adapter compositions cannot be nested')

  for (const adapter of [primary, ...additional]) {
    const guard = requireAdapterGuard(adapter)
    if (adapter !== primary && adapter.authority !== authority)
      throw new InvalidArgumentsException(
        'Additional native adapters must share the primary authority'
      )
    if (Object.hasOwn(adapters, guard))
      throw new InvalidArgumentsException('Native adapters must use unique guards')
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
