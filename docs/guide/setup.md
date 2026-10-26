# Install and configure

This guide configures the native session guard. The signed-in account remains the actor; on covered
business routes, the selected account becomes the effective principal. The package does not create
a target login or credential. For token-only or mixed session/token transport, see the
[opaque access-token guide](access-tokens.md). Also see [security](security.md) for the identity
boundary and [custom authorities](custom-authorities.md) for the native authority contract. The
[API entry-point map](../api-reference.md#supported-package-imports) links supported imports.
Hosts using Account Kit should also read the [Account Kit integration preview](account-kit.md).

## Generate the starter files

Use Node 24 and pnpm. This package version is not published yet. From the package checkout, build
and pack the current source:

```sh
pnpm build
pnpm pack:fixture
```

For a repeatable local alpha self-test, build from the annotated tag selected for the baseline. The
tag identifies the source revision; the package manifest remains `0.0.0`, and no registry version
is provided. After the tag is available, replace `alpha-1` below with the exact tag named in the
repository's maintainer verification record. Create a clean worktree so the selected source and
lockfile stay fixed:

```sh
git fetch origin --tags
git worktree add --detach ../masquerade-alpha-1 alpha-1
cd ../masquerade-alpha-1
nvm use
pnpm install --frozen-lockfile
pnpm build
pnpm pack:fixture
```

Use another unused worktree path if `../masquerade-alpha-1` already exists. Re-run the build and
pack commands after changing the selected source; compare the resulting tarball hash when checking
that two installations use the same artifact.

This creates `tmp/native-session-package.tgz`. In the AdonisJS application, install that artifact
before running its configure command (adjust the path to the package checkout):

```sh
pnpm add file:/path/to/oss-adonisjs-masquerade/tmp/native-session-package.tgz
pnpm add -D @adonisjs/assembler
pnpm add @adonisjs/lucid
node ace configure adonisjs-masquerade --namespace=my_app --guard=web
```

The last two install commands are needed only if those dependencies are absent. Alpha self-testing
uses the local tarball; there is no registry version corresponding to this baseline. Configure
itself does not install packages or run the generated migration.

Choose a stable namespace for this identity domain and the name of the raw session guard. Configure
checks the namespace and guard syntax, that `config/auth.ts` exists, and that the assembler code
transformer and Lucid can be imported. It does not inspect the contents of `config/auth.ts`, check
the selected guard's driver or provider, or prove that the guard is a native session guard. It adds
the package provider, native binding provider, and command loader to `adonisrc.ts`, and creates
starter files and a migration.

Configure then wires the host when its files have the AdonisJS starter-kit shape, and prints the
manual step for anything it leaves alone:

- **`config/auth.ts`**: when `authConfig` is a `defineConfig` call whose default is the `--guard`
  value, and that guard is the starter's `sessionGuard` with a `sessionUserProvider` for
  `#models/user`, configure moves the factory to a constant that uses the generated `userProvider`
  (`webGuard` for `--guard=web`), adds `web_effective: effectiveSessionGuard(webGuard)` and makes
  `web_effective` the default. Any other shape, including a guard you already customised, is not
  changed.
- **`start/kernel.ts`**: configure inserts the context middleware directly after
  `initialize_auth_middleware` in `router.use`. It skips the edit when `initialize_auth` is missing
  or `silent_auth` runs before it.
- **Control routes**: when both edits above are in place, `config/limiter.ts` exists and the kernel
  has the named `auth` middleware, configure writes `start/masquerade_limiter.ts` (separate start
  and stop budgets) and `start/masquerade_routes.ts` (`masqueradeRoutes` on the raw guard) and
  preloads the routes file. Without `@adonisjs/limiter`, the routes step is printed instead.
- **Optional banner**: pass `--banner` on the initial configure command to generate the editable
  `resources/views/components/masquerade/banner.edge` and
  `app/middleware/share_masquerade_status_middleware.ts` files. On a recognized kernel, configure
  registers the middleware after silent authentication. Include the component in an authenticated
  Edge layout with `@include('components/masquerade/banner')`. It displays the target ID, access
  level, deadline, CSRF field, and current context token. The generated files are host-owned and
  can be restyled or replaced; the package ships no runtime UI. The middleware shares the safe
  `ModeView` as `masquerade` with Edge and Inertia only on authenticated effective-guard routes.
  Public, login/logout, and raw control routes do not read mode status. The host may replace the
  displayed target ID with its own label; the package does not inspect application display fields.
- **Optional form controller**: pass `--form-controller` to generate the editable
  `app/controllers/masquerade_form_controller.ts`. Configure wires it to POST start/stop while GET
  status remains on the package controller. The host controller delegates JSON requests to the
  package controller and handles HTML form posts with typed flashes and host-owned redirects. Use
  `--banner --form-controller` together when the generated banner's Stop form should redirect.

  The generated form posts to the named `masquerade.stop` route. With the default package route,
  a successful stop returns JSON, which the browser displays. A host that wants a redirect or
  confirmation page owns that response presentation and the route used by its form.

The identity and policy callbacks stay manual and fail closed. Pass `--no-wire` to skip every edit
above and get only the printed steps. With `--banner --no-wire`, manually register the generated
status middleware in `router.use` after `silent_auth_middleware`, then include the Edge component in
an authenticated layout yourself. If `--form-controller` is also enabled, manually mount its form
routes in place of the package's start/stop routes while retaining the package status route.

Generated files fail closed. Review the output and replace every placeholder described below before
mounting routes. If a generated destination already exists, configure leaves files unchanged and
reports the conflicts; use `--force` only when you intend to replace those destinations.

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
`useRememberMeTokens` value, and any custom provider behavior. If your application already has a
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
import { effectiveSessionGuard } from 'adonisjs-masquerade/auth'
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

## Configure persistent identity and policy

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
import { sessionAuthority, stampFrom } from 'adonisjs-masquerade/native'

const nativeAdapter = sessionAuthority<User>({
  namespace: 'my_app',
  guard: 'web',
  provider: userProvider,
  incarnation: (user) => user.accountIncarnation,
  securityStamp: stampFrom((user) => [user.securityEpoch]),
  // Normalize database boolean representations to the strict boolean expected by the package.
  isActive: (user) => Boolean(user.active),
})

// The generated native binding provider imports this named export at application boot.
export { nativeAdapter }

export default defineConfig<User, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    canMasquerade: ({ actor, target }) =>
      actor.user.masqueradeOperator && target.user.active && actor.id !== target.id,
    canEdit: ({ actor, target }) =>
      actor.user.masqueradeOperator && target.user.active && actor.id !== target.id,
    // Add canUseRequest only when the application needs a request-local rule.
  },
  // Keep the generated store and retention settings. Enforce only after every
  // unsafe business form and client sends its captured context token.
  contextEnforcement: 'enforce',
})
```

This is a configuration fragment; add `stampFrom` to the generated import from
`adonisjs-masquerade/native`, and retain the other generated imports, store, and retention settings.
Set `contextEnforcement` to `enforce` when business forms carry a captured context token: the generated
`report` setting logs stale tokens but allows the request to continue. Enforcement rejects every
covered unsafe business request without the token with 428, including when no one is
masquerading. An application with existing unsafe forms or clients on effective-guard routes keeps
the generated `report` until each one sends the token, as described in
[context tokens and browser clients](security.md#context-tokens-and-browser-clients). Replace the sample model fields and policy with your own. If you choose a store other than the generated Lucid store, see [custom stores](custom-stores.md).
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
changes too. Include a persisted epoch for such events. `inspectAccount` and `securityStamp` must
derive from the same current account state; stale or inconsistent reads can conceal revocation.

Ordinary logout of one session remains the host session credential flow; advance the epoch as part
of logout-all when that action should also revoke every active mode. The host owns which events
advance it. `isActive` must return the current account eligibility as a boolean; a deleted or
ineligible account must not be treated as active.

A start reason is optional by default. Add `reason: 'required'` to the config when every start must
carry a justification; see [use a support mode](usage.md#read-status-and-start).

`canMasquerade` is required and must explicitly authorize the actor-target pair. It runs when a mode
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
authorization and tenant checks in the host's route middleware and handlers. A throw returns
unavailable (503) and leaves the mode unchanged. If no request-local rule is needed, remove the
generated `canUseRequest` property entirely; its `false` placeholder denies every start.

## Wire auth middleware and routes

Add the generated context middleware to `router.use` after Auth initialization and before
`silent_auth` or any later middleware that calls `auth.check()`. Preserve all other host middleware
and their order:

<!-- host-recipe:kernel-order -->

```ts
// start/kernel.ts: router middleware excerpt
router.use([
  // Existing body parser, session, Shield, and other middleware.
  () => import('@adonisjs/auth/initialize_auth_middleware'),
  () => import('#middleware/masquerade_context_middleware'),
  () => import('#middleware/silent_auth_middleware'),
])
```

Keep the supported named `auth` middleware on route groups. Package control routes authenticate
with the raw guard so an active effective identity cannot replace the actor used to stop a mode:

```ts
// Fragment; keep your existing router and kernel imports and define the two limiters.
import { masqueradeRoutes } from 'adonisjs-masquerade/http'

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

Review the generated migration and your database backup plan, then apply it with the host's normal
migration process, for example `node ace migration:run`. Follow [pruning and retention
operations](operations.md) for scheduling and retention; this setup guide does not duplicate that
operational recipe.

After wiring is complete, run the application checks and test with separate actor sessions. Use
`contextEnforcement: 'enforce'` once business forms and clients send their captured context token;
in `report`, stale mutations are logged and allowed through. A temporary `report` phase is only for
updating existing forms and clients and must end with enforcement enabled after their warnings stop. See [security](security.md) for token
handling and the actor/effective identity boundary.
