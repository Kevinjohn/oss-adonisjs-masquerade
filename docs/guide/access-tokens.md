# Opaque access-token transport

V1.1 can authenticate an integrated request with an AdonisJS Auth 10 opaque access token. The
native token guard still validates the bearer credential and exposes the actor's
`currentAccessToken`. Masquerade checks that token's configured ability before reading or changing
the account mode. The same account authority and mode row serve native sessions and tokens. A
bearer token sees the account mode's selected `access` level (`view` or `edit`); there is no
per-token access level. The token's configured ability is a separate capability gate and cannot
upgrade a view mode to edit.

AdonisJS stores a hash of an opaque token, checks it through the native guard, and supports
per-token abilities. A token with `'*'` passes every `allows()` check, including Masquerade's
configured ability. Issue deliberately restricted abilities for least privilege. See the official
[AdonisJS access tokens guide](https://docs.adonisjs.com/guides/auth/access-tokens-guard) for token
provider, guard, expiration, revocation, and ability behavior.

For a runnable local lifecycle against a seeded SQLite app, follow the
[bearer API walkthrough in the existing example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/native-session/README.md#bearer-api-lifecycle).

## Share account authority with sessions

For a mixed session and token application, keep the same account-level authority used by
`sessionAuthority`, then compose the token adapter with it. The token provider must be the
application's native `AccessTokensUserProviderContract` for the selected Auth guard.

```ts
import {
  accessTokensAuthority,
  nativeAuthorities,
  sessionAuthority,
} from 'adonisjs-masquerade/native'

const session = sessionAuthority({
  namespace: 'support-accounts',
  guard: 'web',
  provider: sessionProvider,
  incarnation: 'id',
  securityStamp: accountSecurityStamp,
  isActive: accountIsActive,
})

const tokens = accessTokensAuthority({
  authority: session.authority,
  guard: 'api',
  provider: tokenProvider,
  ability: 'masquerade',
})

const nativeAdapter = nativeAuthorities(session, [tokens])
```

Register `effectiveSessionGuard` for the session business guard and
`effectiveAccessTokensGuard(rawApiGuard, { guard: 'api' })` for a separate effective token guard.
Configure Masquerade with `nativeAdapter.authority`, and bind `nativeAdapter` as
`masquerade.native` in the application container, following the existing [setup guide](setup.md).
The composition requires every adapter to reference the exact same authority object and each raw
guard name to be unique.

The session and token adapters must identify the same account with the same namespace,
canonical provider ID, incarnation, security stamp, and eligibility check. Do not build a second
account namespace for the token transport.

## Token-only Auth configuration

For an application with no session transport, configure the native token provider and guard as
usual, make the effective token guard the Auth default, then pass the same provider to the
standalone Masquerade adapter. The model's `accessTokens` property and migration follow the
[AdonisJS access tokens guide](https://docs.adonisjs.com/guides/auth/access-tokens-guard).

```ts
import { defineConfig } from '@adonisjs/auth'
import { tokensGuard, tokensUserProvider } from '@adonisjs/auth/access_tokens'
import { effectiveAccessTokensGuard } from 'adonisjs-masquerade/auth'
import { accessTokensAuthority } from 'adonisjs-masquerade/native'

const tokenProvider = tokensUserProvider({
  tokens: 'accessTokens',
  model: () => import('#models/user'),
})
const apiGuard = tokensGuard({ provider: tokenProvider })

export default defineConfig({
  default: 'api_effective',
  guards: {
    api: apiGuard,
    api_effective: effectiveAccessTokensGuard(apiGuard, { guard: 'api' }),
  },
})

export const nativeAdapter = accessTokensAuthority({
  namespace: 'support-accounts',
  guard: 'api',
  provider: tokenProvider,
  ability: 'masquerade',
  incarnation: 'id',
  securityStamp: accountSecurityStamp,
  isActive: accountIsActive,
})
```

Use `nativeAdapter.authority` in the Masquerade configuration and bind `nativeAdapter` as
`masquerade.native`, as described in the [setup guide](setup.md). Replace the example namespace
and account callbacks with host-owned values. Standalone token options (`namespace`, `incarnation`,
`securityStamp`, `isActive`) are mutually exclusive with the shared `authority` option.

## Select one guard per route

Select the effective guard in Auth middleware for token business routes:

```ts
router.get('/api/customer', handler).use(middleware.auth({ guards: ['api_effective'] }))
```

Use the matching effective guard for integrated session routes. Controls that call Masquerade
operations select the raw session or token guard explicitly; public and native authentication
routes keep their existing raw or unauthenticated wiring. A token ability is required when a
Masquerade operation runs, including idle status, start, stop, and effective business admission.
The ability is one capability gate; `canMasquerade` remains the host's policy for starting and
active business admission, while stop does not read start policy, stamps, or target data.

Never select a transport from the `Authorization` header, try one credential after another, or
combine distinct raw guards on one route. Same-raw aliases are safe. Conflicting session and token
selection fails closed. This keeps the actor identity tied to the route's declared guard even when
a request includes both a cookie and bearer credential. Native unauthorized responses continue to
come from the selected Auth guard. `silent_auth` on an effective token route resolves the selected
token adapter; it must not use an incidental session cookie.

The guard name must exist in the application's Auth configuration. A registered native raw guard
without a Masquerade adapter can still serve host authentication, security, or logout routes that
do not invoke a Masquerade operation. If such a route calls the Masquerade service, it returns
unavailable before any store access; it never falls back to the primary adapter. Effective guards
must map to a registered Masquerade adapter at application boot.

A raw token route remains an ordinary actor route. Do not put application business behavior behind
it: raw business routes are coverage defects because they bypass effective identity and context
admission. A token without the `masquerade` ability can still use raw native routes, but receives a
forbidden result before any mode read or mutation if it reaches an integrated operation. There is
no fallback to actor business behavior when an integrated operation is denied.

The effective target `User` does not promise `currentAccessToken`. The raw guard retains the actor
and native token. Do not attach the actor token to the target model or treat it as a target
credential. Token revocation makes that credential fail native authentication; it does not clear
the shared mode. A changed account security stamp invalidates the shared mode for subsequent
admission across transports.

## Context, CSRF, and revocation

Covered unsafe requests still require the owner-bound `X-Masquerade-Context` value. Missing context
is 428; stale or conflicting context is 409. Do not refresh a context value and replay an old
action. Bearer-only routes may be explicitly exempted from Shield CSRF protection according to the
host's Shield configuration; session routes keep the host's usual CSRF protection. Context
validation remains required for both transports.

Auth 10 continues to own token creation, expiration, `last_used_at`, and revocation. Masquerade
does not issue, rotate, extend, or copy tokens. See [security boundaries](security.md) for shared
mode behavior and [route coverage review](route-report.md) for raw-route checks.
