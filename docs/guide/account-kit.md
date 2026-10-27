# Account Kit integration preview

This page describes the Account Kit adapter planned for Masquerade v1.2. It is a prerelease
integration preview using Account Kit alpha `0.1.3`, available as a GitHub release artifact. The
package is not published to a public package registry. Install the pinned release tarball with pnpm:

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-account-kit/releases/download/v0.1.3/adonisjs-account-kit-0.1.3.tgz
```

The artifact SHA-256 is
`1ca53538256c360cb87ddbadfaf00f2364a453fea349f6bb8757e58756ed9e7f` and its source commit is
`4b3be3878c7f1cede6080273d84b8841345a3b3a`. This pin supports local development from the GitHub
release artifact; a future public registry publication is a separate release step.

Account Kit's HTTP integration requires the host-provided `@vinejs/vine` `^4.4.0` dependency. The
standard AdonisJS native-auth host already includes it.

Masquerade remains optional and core does not import Account Kit. The Account Kit integration
provides the native authority, checks the actor's configured credential, and installs middleware to
block managed account actions while a mode is active. Configure exactly one transport: the session
or access-token strategy selected by the Account Kit instance. A second Masquerade transport is not
covered by this integration.

## Run the local demo

The [Account Kit support demo README](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/account-kit-demo/README.md)
walks through the fictional operator and customer workflow, including setup, support mode, and
local data reset. It requires Node.js 24, pnpm, JavaScript in the browser, and network access on
first run to fetch the pinned Account Kit release artifact. The demo is for local development.

## Configure the adapter

Create the Account Kit managed guard with the same strategy and guard name configured in Account
Kit. The session example below uses the host's raw session provider from the Masquerade setup guide.
For an `access_tokens` Account Kit configuration, use the same access-token provider as the host's
raw `api` guard and set the adapter's `ability` option as shown below.

```ts
// app/services/account_kit_guard.ts
import { createManagedGuard } from 'adonisjs-account-kit/http'

export const managedGuard = createManagedGuard({
  strategy: 'session',
  name: 'web',
  loadUser: async () => (await import('#models/user')).default,
})
```

For the token strategy, use the host's configured token guard name (the example uses `api`) and
make the token user provider available from the same module used by the raw Auth guard:

```ts
// app/services/web_guard.ts (access_tokens variant)
import { tokensUserProvider } from '@adonisjs/auth/access_tokens'

export const accessTokenUserProvider = tokensUserProvider({
  model: () => import('#models/user'),
  tokens: 'accessTokens',
})
```

```ts
// app/services/account_kit_guard.ts (access_tokens variant)
import { createManagedGuard } from 'adonisjs-account-kit/http'

export const managedGuard = createManagedGuard({
  strategy: 'access_tokens',
  name: 'api',
  loadUser: async () => (await import('#models/user')).default,
})
```

Use that exact `accessTokenUserProvider` instance in the host's raw `api` guard and in the
Masquerade adapter below. The [local fixture's Account Kit configuration](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/account-kit/config/account_kit.ts)
shows how its Account Kit strategy selects the matching `web` or `api` name; its
[admission configuration](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/account-kit/config/admission.ts)
shows the separate host-owned admission policy.

Use one adapter instance for the native binding and Masquerade configuration. This complete session
configuration uses Lucid for the control store; keep your host's existing schema, policy fields and
context-token rollout settings:

```ts
// config/masquerade.ts
import { defineConfig } from 'adonisjs-masquerade'
import { accountKitAuthority } from 'adonisjs-masquerade/account-kit'
import { LucidControlStore } from 'adonisjs-masquerade/stores/lucid'
import { AccountKit } from 'adonisjs-account-kit'
import { AccountAdmission } from 'adonisjs-account-kit/admission'
import app from '@adonisjs/core/services/app'
import { Database } from '@adonisjs/lucid/database'
import type User from '#models/user'
import { managedGuard } from '#services/account_kit_guard'
import { userProvider } from '#services/masquerade_user_provider'

export const nativeAdapter = accountKitAuthority<User>({
  namespace: 'support-accounts',
  incarnation: 'id',
  kit: () => app.container.make(AccountKit),
  managedGuard,
  provider: userProvider,
})
const accountAdmission = () => app.container.make(AccountAdmission)

export default defineConfig({
  authority: nativeAdapter.authority,
  policy: {
    canMasquerade: async ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) &&
      Boolean(target.user.active) &&
      (await accountAdmission()).isAdmitted(target.id),
  },
  store: async () => new LucidControlStore((await app.container.make(Database)).connection()),
  contextEnforcement: 'enforce',
  retention: 'host-managed',
})
```

This block is the session variant. For `access_tokens`, replace the provider import and adapter
options with the exact shared token provider and capability used by the raw token guard:

```ts
// config/masquerade.ts (access_tokens variant)
import { accessTokenUserProvider } from '#services/web_guard'

// Replace the session adapter export above with this variant.
export const nativeAdapter = accountKitAuthority<User>({
  namespace: 'support-accounts',
  incarnation: 'id',
  kit: () => app.container.make(AccountKit),
  managedGuard,
  provider: accessTokenUserProvider,
  ability: 'masquerade',
})
```

The fixture's [Masquerade configuration](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/account-kit/config/masquerade.ts)
shows both variants selected from one environment flag. It imports the host's two raw providers from
`#services/web_guard`; adapt those imports to the exports in your Auth setup, keeping each provider
instance identical between the raw guard and `accountKitAuthority`.

The session example assumes the persisted User model has a canonical `id` primary key, an `active`
field used by Account Kit restriction and host policy, and a `masqueradeOperator` field used by the
sample start policy. Account Kit's Lucid user adapter, the managed guard's `loadUser`, and the Auth
provider must all resolve that same User row and return the same canonical ID. If your host uses a
different primary key, wire that model/provider consistently and adapt the policy fields. Use
`incarnation: 'id'` only if IDs are never reused; otherwise use an immutable per-account value that
changes on delete-and-recreate.

The `enforce` setting requires covered unsafe forms and clients to send context tokens; use `report`
while migrating existing forms. Bind `nativeAdapter` as `masquerade.native` in one provider and set
`authority: nativeAdapter.authority` in the config. The provider pattern is:

```ts
// providers/masquerade_native_provider.ts
import { nativeAdapter } from '#config/masquerade'
import type { ApplicationService } from '@adonisjs/core/types'

export default class MasqueradeNativeProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.bindValue('masquerade.native', nativeAdapter)
  }
}
```

Replace the sample model fields and policy with the host's persisted identity and authorization
rules. `AccountAdmission` is the service from the host's Account Kit admission provider; it reads
the same admission configuration used by Account Kit's route middleware.

The adapter reads Account Kit's account snapshot and revision together. A missing, restricted or
inactive account is ineligible; an operational error fails closed as unavailable. The adapter does
not create a target credential. Account Kit's revision invalidates an active mode when credentials,
`changeRestriction`, or `sessions.revokeAll` changes it. Single-session logout/revoke and
`sessions.revokeOthers` do not advance that revision. A password change with `keepCurrent` can keep
the actor authenticated while the changed revision invalidates the mode on its next admission.

## Keep admission gates in their proper places

Account Kit admission is separate from account restriction. `canAccess` controls whether an account
may authenticate; admission controls whether a signed-in account may use host routes. Keep
`canAccess` restriction-only.

For **actor admission**, resolve `AccountAdmission` from
`adonisjs-account-kit/admission` and gate the host's Masquerade control and business routes before
the global `masqueradeContext` middleware. A route-level `admissionMiddleware` is too late when
`masqueradeContext` runs globally first: active admission can read or invalidate the mode before the
route middleware runs. Use a host global middleware after Auth initialization, scoped to the
explicitly named control and protected business routes. Keep Account Kit's own limited routes and
public authentication flows outside that scope. The example below wraps Account Kit's
`admissionMiddleware` and uses route-name prefixes; change the prefixes to match the routes your
application protects. Every protected control or business route must have a name that matches one
of those prefixes; unnamed routes are outside this gate. For example, name a protected `/business`
route with `.as('business.customers')` when `business.` is in `protectedPrefixes`.

```ts
// app/middleware/account_kit_actor_admission_middleware.ts
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import app from '@adonisjs/core/services/app'
import { AccountAdmission, admissionMiddleware } from 'adonisjs-account-kit/admission'
import { managedGuard } from '#services/account_kit_guard'

const protectedPrefixes = ['masquerade.', 'token.masquerade.', 'business.']
const requireAdmission = admissionMiddleware({
  admission: () => app.container.make(AccountAdmission),
  guard: managedGuard,
})

export default class AccountKitActorAdmissionMiddleware {
  async handle(ctx: HttpContext, next: NextFn): Promise<void> {
    const name = ctx.route?.name
    if (!name || !protectedPrefixes.some((prefix) => name.startsWith(prefix))) {
      await next()
      return
    }
    await requireAdmission(ctx, next)
  }
}
```

Place that middleware before `masqueradeContext` in `start/kernel.ts`. Then a denied actor receives
Account Kit's admission response before Masquerade reads the mode; the row stays untouched and can
resume after approval if no other condition changed. Use `changeRestriction` when revoking admission
must also advance the account revision and invalidate the mode.

For **target admission**, call `(await app.container.make(AccountAdmission)).isAdmitted(target.id)`
from the host's `canMasquerade` policy. Masquerade checks that policy at start and during every
active admission, so a target whose admission is revoked is denied. Do not put the admission lookup
in `canAccess`.

## Install the provider and blocker

Register the Account Kit provider subpath and its global middleware in the host. The middleware
must run after session setup and `initialize_auth`, and before application middleware that calls
`auth.check()`. The provider validates the selected managed guard and checks the registered
`accountKit.*` routes against Account Kit's route registration. Startup fails if the guard or route
registration does not match.

Register the provider after Account Kit and Masquerade's core provider, and put the middleware after
Auth initialization in the global router stack:

```ts
// adonisrc.ts: providers excerpt
providers: [
  // Keep the framework providers required by your strategy (including Lucid and limiter) in
  // their normal host order before the Account Kit provider.
  () => import('adonisjs-account-kit/account_kit_provider'),
  () => import('adonisjs-account-kit/admission/provider'),
  () => import('#providers/masquerade_native_provider'),
  () => import('adonisjs-masquerade/providers/masquerade_provider'),
  () => import('adonisjs-masquerade/account-kit/provider'),
]
```

```ts
// start/kernel.ts: router middleware excerpt
import router from '@adonisjs/core/services/router'

router.use([
  // Session and Shield middleware...
  () => import('@adonisjs/auth/initialize_auth_middleware'),
  () => import('adonisjs-masquerade/account-kit/middleware'),
  () => import('#middleware/account_kit_actor_admission_middleware'),
  () => import('#middleware/masquerade_context_middleware'),
  // silent_auth and other application middleware...
])
```

The `account-kit/middleware` default export is the global blocker. Keep it in the router-wide
middleware stack so it covers every mounted route named `accountKit.*`. Account Kit's `except`
option removes an endpoint from its route registration, so that omitted endpoint is not mounted by
Account Kit. The remaining registered routes are still covered by the global blocker. A host-added
`accountKit.*` route that is absent from Account Kit's registration fails provider validation rather
than becoming an unprotected replacement. During its `ready` hook, the provider validates route
registration and blocker installation once the router is committed; when the host is starting an
Ace command it commits the router itself first, and it never commits in other environments. Call
`registerManagedRoutes` outside any route group that has its own name: a group name prefix would
commit the routes as `<group>.accountKit.*`, which the blocker does not match, so startup fails with
`is not mounted`.

This prerelease interface works with Account Kit `0.1.3`, the only version the optional peer
declares. The complete Masquerade matrix passed against the pinned `0.1.3` GitHub release artifact
for both strategies, with session management on and off, on SQLite and PostgreSQL at the declared
floor and latest compatible peers. Other Account Kit versions, MySQL and a second composed
Masquerade transport are not tested. Account Kit `0.1.1` and later resolve `configProvider` through
`@adonisjs/core`, addressing the Core `7.0.0` Ace-startup failure documented in the
[0.1.1 release notes](https://github.com/Kevinjohn/oss-adonisjs-account-kit/releases/tag/v0.1.1).
The tested artifact hashes and matrix are recorded in the
[maintainer ledger](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/maintainers/requirement-ledger.md#v12-account-kit-acceptance-t-kit-and-t-kit-http).

With an active mode, the global blocker prevents Account Kit's own password, identity, recovery,
session and other managed account operations from changing the operator's account while the UI
shows a target. It returns `403 E_MASQUERADE_ACTION_BLOCKED` with `blockedBy: 'sensitive'` before the
handler. This also applies to an authenticated raw-guard actor whose token lacks the Masquerade
ability. The blocker reads the existing Masquerade row; a store failure returns 503.

`accountKit.account.logout` and `accountKit.auth.csrf` are exempt. Logout remains available so the
operator can end their native session. The CSRF endpoint remains available so a session client can
fetch a token and stop the mode. These two exemptions and unauthenticated managed requests pass
without a Masquerade store read. An authenticated request to another managed route reads the actor's mode row:
an active, unexpired mode is blocked; no row, an idle or expired row, or no active mode for that
actor passes after the read. A store failure returns 503.

## Review the route report

Run `node ace masquerade:routes` after routes are registered. Account Kit routes are reported as
managed and blocked only when the provider has verified the blocker. If the blocker is absent or
unverified, the routes remain `UNCLASSIFIED` with an explanatory note. Review that report alongside
the [route coverage guide](route-report.md); the report does not replace review of host middleware
or route behavior.

## Database and verification boundary

On SQLite, Masquerade's active business admission runs three Account Kit transactions: `current`
validates the actor, then `inspectAccountAccess` inspects the actor and target. Each transaction
takes the database writer lock, so active-mode traffic serializes with Account Kit writes. With
session management enabled, `current` also writes the session's last-seen time. On a route covered
by the host admission gate, `AccountAdmission.require` adds another transaction before
`masqueradeContext`; `isAdmitted` in `canMasquerade` also performs policy reads on active admission.
An idle request that passes through Account Kit's managed authentication runs one adapter `current`
transaction, plus the host gate transaction if that route is in its scope. Retries can re-run
callbacks, including `canAccess`, so keep them safe to retry. PostgreSQL locks the individual
account row. Masquerade supports this integration only on SQLite and PostgreSQL, matching its
existing database support; this preview does not claim MySQL support.

This integration remains a prerelease preview. The GitHub release artifact is installable for local
development; public registry publication is separate from integration acceptance. Check the
[troubleshooting guide](troubleshooting.md) for common configuration failures.
