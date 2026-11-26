# Install and configure

This guide configures the native session guard. The signed-in account remains the actor; on covered
business routes, the selected account becomes the effective user. The package does not create
a target login or credential. For token-only or mixed session/token transport, see the
[opaque access-token guide](access-tokens.md). Also see [security](security.md) for the identity
boundary and [custom authorities](custom-authorities.md) for the native authority contract. The
[API entry-point map](https://kevinjohn.github.io/oss-adonisjs-masquerade/reference/index#supported-package-imports) links supported imports.
Hosts using Account Kit should also read the [Account Kit integration preview](account-kit.md).

This guide follows the current checkout. For the published archive, follow the
[0.7.1 setup guide](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/v0.7.1/docs/guide/setup.md).

## Generate the starter files

Use Node 24 and pnpm. Masquerade is not published to a package registry. The
`0.7.1` [GitHub release](https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/tag/v0.7.1)
carries the packed tarball. Install it directly in the AdonisJS application:

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/download/v0.7.1/kevinjohn-adonisjs-masquerade-0.7.1.tgz
```

The release notes list the tarball SHA-256, and the `v0.7.1` tag marks the source commit. To build
the same version yourself, check out the tag in a clean worktree so the source and lockfile stay
fixed:

```sh
git fetch origin --tags
git worktree add --detach ../masquerade-v0.7.1 v0.7.1
cd ../masquerade-v0.7.1
nvm use
pnpm install --frozen-lockfile
pnpm build
pnpm pack:fixture
```

Use another unused worktree path if that one already exists. To test unreleased changes, run
`pnpm build` and `pnpm pack:fixture` in your package checkout instead.

A local build creates `tmp/native-session-package.tgz`; install it in place of the release URL
(adjust the path to the package checkout):

```sh
pnpm add file:/path/to/oss-adonisjs-masquerade/tmp/native-session-package.tgz
```

Then add any missing peers and run the configure command:

```sh
pnpm add -D @adonisjs/assembler
node ace add @adonisjs/lucid
node ace configure @kevinjohn/adonisjs-masquerade --namespace=my_app --guard=web
```

The scoped `0.7.1` release registers `@kevinjohn/adonisjs-masquerade/masquerade_provider`.
Replace the previous provider path in existing `adonisrc.ts` entries and provider type imports.

The two install commands are needed only if those dependencies are absent; `node ace add` also
configures Lucid. Configure itself does not install packages or run the generated migration.

Choose a stable namespace and the raw session guard name. Configure checks the name syntax,
`config/auth.ts`, `#models/user`, the assembler and Lucid. It registers the package provider, native
adapter provider and Ace commands in `adonisrc.ts` and drafts the config, shared user provider and
migration. Keep any custom host directories and the corresponding import aliases aligned.

- Add the effective guard and register the context middleware using the steps below.
- Use `--control-routes` after configuring AdonisJS Limiter to draft `start/masquerade_routes.ts` (or `start/masquerade_form_routes.ts` with the form controller)
  and `start/masquerade_limiter.ts`. Review both limiter budgets and CSRF protection, then import
  the routes from the host's routes preload.
- Use `--banner` to draft the host-owned status middleware and Edge banner. Register the middleware
  after silent authentication and include `components/masquerade/banner` in an authenticated
  layout. The middleware shares the safe `ModeView` with Edge and Inertia on authenticated
  effective routes.
- Use `--form-controller` to draft an HTML form adapter. With `--control-routes`, the route file
  uses that controller. Otherwise mount it explicitly behind the raw guard with separate rate
  limiters and CSRF protection. Edit its redirects and flash rendering.

Configure preserves the path and contents of an existing Masquerade migration, even with `--force`.
Without `--force` it reports conflicting scaffold paths before writing. Multiple Masquerade
migrations stop generation. Complete the fail-closed callbacks and apply the reviewed migration
before serving the routes.

## Reuse the session user provider

The raw session guard and `sessionAuthority` must share the same provider object. The generated
`app/services/masquerade_user_provider.ts` exports one provider instance. Import it into the raw
guard factory and use that same export in the generated `config/masquerade.ts`:

<!-- host-recipe:web-guard -->

```ts
// app/services/web_guard.ts
import { sessionGuard } from '@adonisjs/auth/session'
import { userProvider } from '#services/masquerade_user_provider'

export const webGuard = sessionGuard({
  useRememberMeTokens: true,
  provider: userProvider,
})
```

This is a wiring fragment: keep your existing session options, including your current
`useRememberMeTokens` value, and any custom provider behaviour. If your application already has a
provider, export and reuse that exact instance instead of creating a second provider. The
`userProvider` imported by `sessionAuthority` below must be the same object used by `webGuard`.

Add an effective wrapper beside the raw guard in your existing `config/auth.ts`. The example keeps
an existing `members` guard with its own provider and remember-me setting. Keep that guard and its
options unchanged in your application:

<!-- host-recipe:member-guard -->

```ts
// Existing app/services/member_guard.ts; keep this separate guard and its options.
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'

export const memberProvider = sessionUserProvider({ model: () => import('#models/member') })
export const memberGuard = sessionGuard({ useRememberMeTokens: false, provider: memberProvider })
```

<!-- host-recipe:auth-config -->

```ts
import { defineConfig } from '@adonisjs/auth'
import { effectiveSessionGuard } from '@kevinjohn/adonisjs-masquerade/auth'
import { memberGuard } from '#services/member_guard'
import { webGuard } from '#services/web_guard'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

const authConfig = defineConfig({
  // Set the business default to the effective guard so ordinary auth uses the target when active.
  default: 'web_effective',
  guards: {
    web: webGuard,
    members: memberGuard,
    web_effective: effectiveSessionGuard(webGuard),
  },
})

export default authConfig

declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  interface EventsList extends InferAuthEvents<Authenticators> {}
}
```

The existing second guard remains registered with its own provider, session options, and inferred
types. Preserve any additional guards and configuration in the same way. The one intentional default
change is to set `default` to `web_effective`; keep the raw `web` guard for login, signup, logout,
and package control routes. Do not combine raw and effective guards on one business route.

If your application already has a custom session provider, keep using that provider instance for
`webGuard` and change the `provider` import in `config/masquerade.ts` to the same exported instance.
Remove or leave unused the generated `masquerade_user_provider.ts`; do not create a second
`sessionUserProvider`. The generated config's default import is shown in the next section.

<a id="configure-persistent-identity-and-policy"></a>

## Configure persistent identity and host callbacks

The generated `config/masquerade.ts` imports `userProvider` from
`#services/masquerade_user_provider`, the same module used by `web_guard.ts` above. Keep that import
and provider unchanged; do not create a second `sessionUserProvider`. Adapt the callbacks to
persistent fields owned by your User model. This example assumes the host model has a numeric `id`,
an immutable `accountIncarnation` string, a boolean `active`, a `securityEpoch` that the host
advances when account-wide revocation is required, and the operator policy field shown below:

<!-- host-recipe:identity-policy -->

```ts
// Relevant part of config/masquerade.ts
import type User from '#models/user'
import { userProvider } from '#services/masquerade_user_provider'
import { sessionAuthority, stampFrom } from '@kevinjohn/adonisjs-masquerade/native'

const nativeAdapter = sessionAuthority<User>({
  namespace: 'my_app',
  guard: 'web',
  provider: userProvider,
  incarnation: (user) => user.accountIncarnation,
  securityStamp: stampFrom((user) => [user.securityEpoch]),
  // Normalise database boolean representations to the strict boolean expected by the package.
  isActive: (user) => Boolean(user.active),
})

// The generated native binding provider imports this named export at application boot.
export { nativeAdapter }

export default defineConfig<User, HttpContext>({
  authority: nativeAdapter.authority,
  permissions: {
    // Never let an operator act as anyone with more privilege: edit access there lets them grant
    // themselves that privilege. Refusing other operators is the recommended default.
    canMasquerade: ({ actor, target }) =>
      actor.user.masqueradeOperator &&
      !target.user.masqueradeOperator &&
      target.user.active &&
      actor.id !== target.id,
    canEdit: ({ actor, target }) =>
      actor.user.masqueradeOperator &&
      !target.user.masqueradeOperator &&
      target.user.active &&
      actor.id !== target.id,
    // Add canUseRequest only when the application needs a request-local rule.
  },
  // Keep the generated store and retention settings. Enforce only after every
  // unsafe business form and client sends its captured context token.
  contextEnforcement: 'enforce',
})
```

Refusing operator targets is a recommended default; see
[allow operator targets for view access](../recipes/who-can-masquerade.md#allow-operator-targets-for-view-access)
for the alternative.

This is a configuration fragment; add `stampFrom` to the generated import from
`@kevinjohn/adonisjs-masquerade/native`, and retain the other generated imports, store, and retention settings.
Set `contextEnforcement` to `enforce` when business forms carry a captured context token: the generated
`report` setting logs stale tokens but allows the request to continue. Enforcement rejects every
covered unsafe business request without the token with 428, including when no one is
masquerading. An application with existing unsafe forms or clients on effective-guard routes keeps
the generated `report` until each one sends the token, as described in
[context tokens and browser clients](security.md#context-tokens-and-browser-clients). Replace the sample model fields and host callbacks with your own. The callbacks stay under the `permissions` key in the public config. `authority` and `permissions` may instead come from the callback registration: see
[registering callbacks from a provider](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/README.md#registering-callbacks-from-a-provider). If you choose a store other than the generated Lucid store, see [custom stores](custom-stores.md).
`incarnation` must be stable for one account's lifetime and different if a deleted ID can be
reused. Use `incarnation: 'id'` only if the host guarantees account IDs are never reused. The
incarnation must not change during ordinary security updates.

For a reusable numeric ID, an immutable creation timestamp can distinguish account lifetimes when
the database's timestamp precision guarantees a different value for each reuse:

```ts
incarnation: (user) => user.createdAt.toISO()!,
```

If that guarantee does not hold, persist a generated immutable incarnation value instead. Keep this
choice explicit; `stampFrom` does not supply or infer an incarnation.

`stampFrom` returns a deterministic SHA-256 digest of the selected scalar fields. It frames each
UTF-8 value with its type and byte length before hashing, so adjacent values cannot become
ambiguous. Strings, finite numbers, booleans, bigints and `null` are supported; an `undefined` field
throws, so a missing or unloaded property fails closed instead of producing a constant stamp. Convert
Lucid `DateTime` values to a stable representation such as `.toISO()` in the selector. The package
hashes the returned stamp again before storage; the helper's digest is not encryption or a secret.

Choose fields that cover every account-wide event that should revoke active modes. Common Lucid
choices include:

| Field                     | What it detects                                                | Limits                                                                                             |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `password`                | Password hash changes, including password reset or change      | A password rehash can also revoke modes even when the password itself did not change.              |
| `role` or `isAdmin`       | Changes represented by that column                             | Does not detect changes in a separate roles or permissions table.                                  |
| `suspendedAt` or `active` | Suspension or active-status changes                            | Returns to its earlier value on reactivation; see below.                                           |
| `securityEpoch`           | Every event for which the host increments this persisted epoch | This is the broadest option when updated transactionally and read from the current account record. |

A column that returns to its earlier value restores the earlier stamp. Suspending and then
reactivating an account, or demoting and then restoring a role, before the account's next request
leaves its active modes in place. Select `securityEpoch` for every event that must always revoke.

For example, `securityEpoch` should advance transactionally after password changes or resets,
privilege changes, suspension or reactivation, and account-wide logout/revocation whenever those
events must invalidate active modes. Keep the epoch visible to the provider's current user lookup.
Unrelated fields such as email or display name need not be selected unless the host wants those
changes to revoke modes. Do not use a constant, a timestamp generated on each lookup, or a value
that can remain stale in a cache.

The helper detects changes only to the values the host selects. It cannot see credential or session
revocation, related-table permission changes, or external account status unless a selected field
changes too. Include a persisted epoch for such events. The native adapter uses `securityStamp`
when producing its `inspectAccount` snapshot. Custom authorities must derive the snapshot stamp
from current account state. Stale reads can conceal revocation.

Ordinary logout of one session remains the host session credential flow; advance the epoch as part
of logout-all when that action should also revoke every active mode. The host owns which events
advance it. `isActive` must return the current account eligibility as a boolean; a deleted or
ineligible account must not be treated as active.

A start reason is optional by default. Add `reason: 'required'` to the config when every start must
carry a justification; see [use a support mode](usage.md#read-status-and-start).

`canMasquerade` is required and must explicitly authorise the actor-target pair. It runs when a mode
starts with `request` and any supplied `reason` available, and again on each active admission without either
value. A `false` result at start denies the start. A `false` result during active admission is a
global denial: Masquerade invalidates the mode and rejects that request with context-changed (409).
A thrown callback fails the request with unavailable (503) and leaves the mode unchanged.

`canEdit` is optional and grants edit only when it returns literal `true`. View is always the
default. An explicit `access: 'edit'` start calls it after `canMasquerade` and before
`canUseRequest`, with `reason` and `request`. Each active edit admission rechecks it without
those values. A denial invalidates the whole mode with `edit_denied`; a throw returns 503
without changing the mode. View starts and admissions never call it.

`canUseRequest` is optional. Add it only for request-local rules such as tenant or route access. It
runs during start and during active-mode admission, with the request in both cases. A `false` at
start denies the start without creating a mode; a `false` during active-mode admission rejects only
that request (403) and leaves the mode unchanged, so access may still work on another eligible
route. It does not run for ordinary idle-route requests or every control route; keep ordinary host
authorisation and tenant checks in the host's route middleware and handlers. A throw returns
unavailable (503) and leaves the mode unchanged. If no request-local rule is needed, remove the
generated `canUseRequest` property entirely; its `false` placeholder denies every start.

## Wire auth middleware and routes

Add the package context middleware to `router.use` after Auth initialisation and before
`silent_auth` or any later middleware that calls `auth.check()`. Preserve all other host middleware
and their order:

<!-- host-recipe:kernel-order -->

```ts
// start/kernel.ts: router middleware excerpt
router.use([
  // Existing body parser, session, Shield, and other middleware.
  () => import('@adonisjs/auth/initialize_auth_middleware'),
  () => import('@kevinjohn/adonisjs-masquerade/masquerade_context_middleware'),
  () => import('#middleware/silent_auth_middleware'),
])
```

Keep the supported named `auth` middleware on route groups. Package control routes authenticate
with the raw guard so an active effective identity cannot replace the actor used to stop a mode:

```ts
// Fragment; keep your existing router and kernel imports and define the two limiters.
import { masqueradeRoutes } from '@kevinjohn/adonisjs-masquerade/http'

masqueradeRoutes(router, {
  auth: middleware.auth,
  guard: 'web',
  startLimiter: startMasqueradeLimiter,
  stopLimiter: stopMasqueradeLimiter,
})
```

Apply your host's CSRF protection and separate start and stop rate limits. Put business route
groups behind `middleware.auth({ guards: ['web_effective'] })`. See [route coverage review](route-report.md)
for report labels and release checks. The host still owns CSRF, the limiter budgets and where the
routes are mounted.

Fresh migrations import `createMasqueradeSchemaV1` and `dropMasqueradeSchemaV1` from
`@kevinjohn/adonisjs-masquerade/stores/lucid`. Those helpers are the fixed initial schema contract.
Use the same versioned imports if your application creates or rolls back the Masquerade tables
inside its own baseline migration. Earlier migrations can still resolve `createMasqueradeSchema`
and `dropMasqueradeSchema`.

Review the generated migration and your database backup plan, then apply it with the host's normal
migration process, for example `node ace migration:run`. Follow [pruning and retention
operations](operations.md) for scheduling and retention; this setup guide does not duplicate that
operational recipe.

After wiring is complete, run the application checks and test with separate actor sessions. Use
`contextEnforcement: 'enforce'` once business forms and clients send their captured context token;
in `report`, stale mutations are logged and allowed through. A temporary `report` phase is only for
updating existing forms and clients and must end with enforcement enabled after their warnings stop. See [security](security.md) for token
handling and the actor/effective identity boundary.
