# Use a support mode

This guide follows one browser session from a raw operator session to a customer-specific business
page and back. It uses the native-session integration: the operator remains authenticated by the
`web` guard while the `web_effective` guard resolves the customer as the effective account. The
customer never signs in, and the operator's permissions are never added to the customer's.

Install and configure the provider, raw and effective guards, policy, session, and Shield first as
described in [Install and configure](setup.md). Keep login, logout, and support controls on the raw
actor guard. Keep customer business routes on the effective guard. See the
[API entry-point map](../reference/README.md#supported-package-imports) for the HTTP entry point,
`MasqueradeController`, `masqueradeContext`, and the route markers used below.

## Mount the JSON controls

`MasqueradeController` implements JSON status, start, and stop responses. The package controller
does not render Edge or redirect. Its control responses are `no-store` and vary on `Accept` and
`X-Masquerade-Context`. The native-session example mounts the controls with `masqueradeRoutes`,
raw session authentication and independent host-owned start and stop limiters. Keep Shield's CSRF middleware
enabled for cookie-authenticated POST requests.

<!-- host-recipe:control-routes -->

```ts
import { middleware } from '#start/kernel'
import { startMasqueradeLimiter, stopMasqueradeLimiter } from '#start/masquerade_control_limiter'
import router from '@adonisjs/core/services/router'
import { masqueradeRoutes } from '@kevinjohn/adonisjs-masquerade/http'

masqueradeRoutes(router, {
  auth: middleware.auth,
  guard: 'web',
  startLimiter: startMasqueradeLimiter,
  stopLimiter: stopMasqueradeLimiter,
})
```

`masqueradeRoutes` mounts `GET /masquerade`, `POST /masquerade/start` and `POST /masquerade/stop`
on `MasqueradeController`, named `masquerade.status`, `masquerade.start` and `masquerade.stop`. It
applies `auth({ guards: [guard] })` to the group and each limiter to its own route. It throws at
registration when the guard, the auth middleware or either limiter is missing, or when both
limiters are the same middleware. `prefix` and `as` change the path and name prefixes, for example
`prefix: '/api/masquerade', as: 'token.masquerade'` for an access-token guard. It returns the route
group, so the host can add middleware or a domain. Mount the routes by hand only when the controls
need a different shape; [route coverage review](route-report.md) reports both as `CONTROL`.

Define separate budgets keyed by the authenticated raw actor. Tune these limits to the host's
support workflow and infrastructure; the package does not install or configure a limiter.

<!-- host-recipe:control-limiters -->

```ts
import limiter from '@adonisjs/limiter/services/main'
import env from '#start/env'
import type User from '#models/user'

const duration = '1 minute'

export const startMasqueradeLimiter = limiter.define('masquerade_start', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return limiter
    .allowRequests(env.get('MASQUERADE_START_REQUESTS') ?? 10)
    .every(duration)
    .usingKey(String(actor.id))
})

export const stopMasqueradeLimiter = limiter.define('masquerade_stop', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return limiter
    .allowRequests(env.get('MASQUERADE_STOP_REQUESTS') ?? 10)
    .every(duration)
    .usingKey(String(actor.id))
})
```

The actor-owned target chooser is a host query over accounts eligible for support. Do not expose
all account IDs and rely on the submitted ID alone: start policy checks eligibility again. For
example, the checked-in native-session demo filters active seeded customers for operator accounts.
Display a host-owned label (such as a name and email), not an internal identifier as the choice
label.

## Read status and start

The [same-origin JSON client](./clients/json.md) runs this workflow in the native-session example.

Read `GET /masquerade` before rendering a control. An idle response is:

```json
{
  "isMasquerading": false,
  "contextToken": "0.<owner-specific-nonce>"
}
```

Render that context token with the form and Shield's CSRF field. The token is bound to the raw actor
and changes after committed transitions. It prevents stale/replayed context; it is not an
authentication credential and does not replace CSRF.

Submit `POST /masquerade/start` with `targetId`, an optional `reason`, optional numeric
`durationSeconds`, optional `access` (`'view'` or `'edit'`), and the token captured with this form. Send the token as
`X-Masquerade-Context` or `_masqueradeContext`; if both are sent they must agree. For a
cookie-authenticated request, also send the host's Shield CSRF token. A JSON request body can look
like this:

```json
{
  "targetId": 42,
  "reason": "Investigating a reported invoice display issue",
  "durationSeconds": 900,
  "access": "view"
}
```

Omitting `access` selects view. Choose **Can edit** deliberately in the start form and send
`access: 'edit'` when the host's `canEdit` policy permits it. The level stays fixed until stop;
restart to choose another level. See the [access contract](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/maintainers/design/spec-masquerade.md#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026).

The default duration is 900 seconds and the default maximum is 3600 seconds. A host can configure
a shorter duration and maximum. When duration is omitted, the configured default is used;
otherwise it must be an integer from 60 seconds through the configured maximum. The package does
not extend a deadline on later requests.

A reason is optional by default: an absent or blank reason starts the mode and the audit stores
none, so a start form can be a single button. Set `reason: 'required'` in `config/masquerade.ts`
when every start must be justified; a start without a reason is then rejected. A supplied reason
is trimmed and CRLF line endings are normalized to LF. LF and TAB are the only control characters
permitted inside the normalized reason. It must contain 1–500 Unicode code points and no more than
2,000 UTF-8 bytes. Invalid input is rejected, never truncated. Keep secrets and unnecessary
personal information out of the reason.

A successful start returns an active `ModeView` with a fresh token:

```json
{
  "isMasquerading": true,
  "contextToken": "1.<new-owner-specific-nonce>",
  "targetId": "42",
  "access": "view",
  "startedAt": "2026-10-20T10:15:00.000Z",
  "expiresAt": "2026-10-20T10:30:00.000Z"
}
```

The request accepts a string target ID or a safe integer; the response uses its canonical string
form. Only these fields are returned: the state, token, target ID, access level, start time, and fixed deadline. The
view does not contain the reason, actor or target model, stamps, or raw revision. Treat the token
as a hidden concurrency value, not something to display. A persisted active row is usable only
while `expiresAt` is strictly later than the current time. Status is read-only; an expired row can
still appear active until business admission or cleanup handles it. See
[Security and operations](security.md#duration-transition-and-recovery-behavior) for that boundary.

## Use the effective customer identity

Attach the route markers from the public HTTP entry point and the effective guard to business
routes. Reads remain available under the effective identity. With edit access, `allowMutation()`
permits an ordinary, non-sensitive mutation through route classification; the customer's normal Bouncer
policy still decides whether the handler may act. `sensitive()` always blocks an active support
mode, even if a route also has `allowMutation()`.

<!-- host-recipe:business-routes -->

```ts
import { allowMutation, sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'

router
  .get('/support/customer', [() => import('#controllers/demo_controller'), 'customer'])
  .as('demo.customer')
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/customer/preference', [
    () => import('#controllers/demo_controller'),
    'preference',
  ])
  .as('demo.preference')
  .use(allowMutation())
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/customer/sensitive', [() => import('#controllers/demo_controller'), 'sensitive'])
  .as('demo.sensitive')
  .use(sensitive())
  .use(middleware.auth({ guards: ['web_effective'] }))
```

The handler authorizes the effective customer, never the raw actor. The complete controller recipe
below includes the `Bouncer<User>` helper and a customer-owned reversible preference mutation. The
customer's normal business ability still applies; edit access and `allowMutation()` are both
required for a non-sensitive mutation. The sensitive route is rejected before its handler runs. Do not
offer a bypass for it during support mode.

## Stop with the refreshed token

Every rendered stop form uses the current `contextToken`, including a stop form shown on a customer
page. Send it to `POST /masquerade/stop` with CSRF. A successful stop returns an idle view and
another fresh token:

```json
{
  "isMasquerading": false,
  "contextToken": "2.<new-owner-specific-nonce>"
}
```

Use this returned token for the next control or business form. Each form/action must retain the
token that was rendered with its original user intent. If another tab changes the mode while a
form is open, refresh status and have the operator deliberately rebuild and submit the action.
Never fetch a fresh token in an interceptor and automatically replay an old request.

## Next steps

- [Edge forms and host redirects](clients/edge.md): adapt the service to host-rendered forms.
- [Recover from errors](errors.md): error items, status codes and recovery after a lost response.
- [Audit business work and observe transitions](audit.md): business audit fields, observers and
  the masquerade history page.
