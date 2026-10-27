# Getting started

Masquerade supports AdonisJS 7 applications and Node.js 24 or later. The session setup is covered
here; opaque access tokens are also supported through the [access-token guide](access-tokens.md).
It keeps the operator authenticated as the **actor** while the selected account is the
**effective identity** for covered business routes. The target does not sign in, receive a
credential, or inherit the actor's permissions.

The mode is stored once per actor account and authority namespace. Every valid integrated session
and token with the configured ability sees the same mode, so logging out one browser does not stop
another authorized credential from using it. A mode has a fixed deadline. Forms and other unsafe requests carry a context token that
records the mode revision when the user's intent was created. If that token is missing or stale,
refresh the page and deliberately rebuild the action; never replace the token and replay the old
intent automatically.

## Choose a path

- **Try the working demo.** Follow the [native-session demo instructions](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/native-session/README.md#one-command-demo)
  to run the fictional operator and customer application.
- **Add support mode to an existing app.** Continue with [Install and configure](setup.md), then
  follow [Use a support mode](usage.md). Keep the current session provider and guard, review the
  generated files, and make the host-owned callback and route decisions below before enabling
  business routes.
- **Choose a delivered client integration.** [Edge forms](clients/edge.md)
  capture the context token with the original form intent. For a same-origin browser client, see
  the [JSON client guide](clients/json.md)
  and its runnable [native-session example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/native-session).
  For React and Inertia, see the [React client guide](clients/react.md)
  and runnable [Inertia example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/inertia-react).
  For Vue and Inertia, use the [Vue integration guide](clients/vue.md) and its
  [runnable Vue example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/inertia-vue).

## Integrate in this order

1. **Preserve native authentication.** Keep the existing provider instance and raw session guard
   for login, logout, and Masquerade controls. Add the effective guard alongside it; do not replace
   unrelated guards or provider behavior. The complete generated-file review is in
   [Install and configure](setup.md#reuse-the-session-user-provider).
2. **Configure identity and security policy.** Review the generated namespace, guard,
   `incarnation`, `securityStamp`, `isActive`, and store. The default `node ace configure`
   scaffolding requires `@adonisjs/assembler` and `@adonisjs/lucid` to be installed and importable,
   even when you later choose another store. Configure does not edit auth configuration, routes,
   or the HTTP kernel. Review conflicts and boot diagnostics rather than forcing generated files
   over existing application code.
3. **Choose host-owned callbacks.** `canMasquerade` is required and must explicitly authorize the
   actor-target pair at start and on every active admission. Decide what persisted security epoch
   changes invalidate all modes, and how target account-wide eligibility is checked. Add
   `canUseRequest` only for request-local rules such as tenant or route access. Do not use a
   permissive placeholder. See [Configure persistent identity and policy](setup.md#configure-persistent-identity-and-policy).
4. **Apply the migration and wire admission.** Run the migration using the host's normal process.
   Put context middleware after Auth initialization and before middleware that calls `auth.check()`.
   Keep controls on the raw actor guard and business routes on the effective guard. Preserve
   Shield CSRF and host rate limits on state-changing controls.
5. **Add context to every covered unsafe client.** Edge forms include the rendered token; clients
   send their captured token with each mutation. Use `contextEnforcement: 'report'` while migrating,
   then switch to `enforce` after coverage is complete and warnings stop. A refreshed token does
   not authorize an old form's intent.
6. **Review coverage and exercise two sessions.** Run `node ace masquerade:routes`, review every
   business and raw-guard route, then verify start, stop, fixed expiry, stale forms, and the shared
   mode from two valid sessions. See [route coverage review](route-report.md) and
   [Use a support mode](usage.md).

For identity boundaries, request-local denial, audit, and side-effect limits, see
[Security and operations](security.md). For detailed control and Edge recipes, keep using
[Use a support mode](usage.md); this page is only the path through them.
