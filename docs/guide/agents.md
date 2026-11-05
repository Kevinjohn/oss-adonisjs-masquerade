# Integration notes for agents

These notes help code agents integrate Masquerade into an existing AdonisJS application. The host
application owns authorization, language, route policy, tenant context, rate limits, session
provider configuration and user-facing controls.

## Before editing the host application

1. Read the [setup guide](./setup.md) and [security guide](./security.md). For a new app built
   from an official starter kit, follow the [starter-kit recipe](../recipes/starter-kit.md) step
   by step; the [recipe index](../recipes/index.md) maps other tasks to the files they change.
2. Read generated configure output and inspect every generated callback. Never replace a host's
   user provider or guard without checking its current Auth configuration.
3. Keep the exact same session user-provider instance in raw session auth and `sessionAuthority`.
   When adding access-token transport, use the same account authority object for session and token
   adapters; keep the raw Auth 10 token provider and guard intact.
4. Configure an immutable account incarnation when IDs can be reused, and a security stamp that
   changes for password, privilege, suspension and logout-all events.
5. Replace deny-by-default placeholders with explicit host checks. Do not add an allow-all policy.

## Request wiring

- `masqueradeContext` belongs after `initialize_auth` and before `silent_auth`.
- Effective business routes use one selected effective session or token guard. Login, signup,
  logout and status/start/stop controls use the explicitly selected raw guard.
- A route selects its auth guard explicitly. Never choose session or bearer auth by inspecting
  request headers or falling back between credentials. Integrated token routes use the effective
  token guard; raw token routes keep native actor behavior.
- Configure the token adapter with the `masquerade` ability. It gates integrated idle and active
  routes, including status, start and stop. Auth 10 wildcard tokens satisfy every ability check, so
  issue restricted token abilities deliberately. The effective target user does not carry the
  actor's `currentAccessToken`; access the credential through the selected raw guard.
- Mount controls behind Shield CSRF and separate host limiter budgets for start and stop.
- Every covered unsafe business request sends `X-Masquerade-Context` (fetch/Inertia) or the
  `_masqueradeContext` hidden field. Do not refresh a token and replay the old action.
- Review `node ace masquerade:routes` before release. Fix or consciously account for every raw
  business route it flags; the report is a release gate, not an automatic registry.
- Masquerade starts in view-only mode. If the host offers edit access, require `canEdit` to return
  exactly `true` at start and active edit admission. `allowMutation()` only opts an ordinary route
  into writes in edit mode; it does not grant edit access or target authorization. Mark billing
  mutations and other security-sensitive actions with `sensitive()`, which always blocks. URL names
  do not make a route sensitive automatically.

## Identity and operational boundaries

Use the target for ordinary business Auth/Bouncer checks and the raw session guard for actor
identity. Do not union permissions. A global eligibility or security-stamp change ends the mode;
a request-local tenant denial rejects only that request. A valid session may stop the mode despite
eligibility, stamp, target, or policy changes; token controls also require the configured ability.

Logout of one session ends that credential only. Other valid sessions retain the account-wide
mode. Expiry is fixed and non-sliding. Already-admitted requests and work handed to jobs or external
systems cannot be recalled; propagate the safe actor/effective projection and reauthorize in the
host worker where needed.

Keep audit reasons bounded and free of secrets or unnecessary personal data. Successful start
records the normalized reason; denied and invalid control attempts omit it. Never log credentials,
stamps, request bodies or raw user objects. Review [retention and erasure guidance](./security.md#jobs-external-effects-and-audit)
before changing audit retention.
