# Masquerade documentation

Masquerade lets an authorized support operator use an AdonisJS application through a customer's
account while remaining authenticated as the operator. The account-wide mode is shared across
valid integrated sessions and opaque access tokens, has a fixed duration, and can be explicitly
stopped. Token adapters preserve Auth 10 bearer validation and require a configured ability.

## Get started

Start with [Getting started](guide/getting-started.md) to choose a runnable demo or integrate
Masquerade into an existing application. The [native-session demo](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/native-session/README.md)
shows the operator as the authenticated actor, the customer as the effective identity, the fixed
deadline, and how to stop the mode.

[Add masquerade to AdonisJS](guide/walkthrough.md) follows the fictional support journey
with real application screenshots.

## Guides

- [Install and configure](guide/setup.md): scaffold the package files, preserve the existing
  session provider, and wire callbacks, middleware, and host-protected routes.
- [Opaque access tokens](guide/access-tokens.md): configure token-only or mixed session/token
  transport, select guards explicitly, and gate integrated access with token abilities.
- [Use a support mode](guide/usage.md): follow the complete status, start, customer-work and stop
  journey.
- [Edge forms](guide/clients/edge.md): adapt the service to host-rendered forms and redirects.
- [Recover from errors](guide/errors.md) and [audit and history](guide/audit.md): error responses,
  business audit fields, observers and the masquerade history page.
- [Alert on masquerade activity](guide/alerts.md): listener recipes for chat alerts and a
  dedicated log sink.
- [Testing your routes](guide/testing.md): the Japa `masquerading()` request helper for host route
  tests.
- [Session JSON client](guide/clients/json.md): run same-origin fetch controls and customer
  actions with session cookies, CSRF, captured context, and deliberate recovery.
- [Inertia React](guide/clients/react.md): run the React support workflow with captured form
  context, refreshed customer pages, and deliberate recovery.
- [Inertia Vue](guide/clients/vue.md): run the fictional support workflow with Vue forms and
  page recovery after an identity change.
- [Supported package imports](api-reference.md#supported-package-imports): map public package
  entry points to their API references.

## Security and operations

- [Troubleshooting](guide/troubleshooting.md): diagnose setup and boot problems, missing or stale
  context, denied actions, expiry, and storage failures.
- [Security boundaries](guide/security.md): actor and customer identity, sessions, authorization,
  context tokens, expiry, audit, and side effects.
- [Custom authorities](guide/custom-authorities.md): provide coherent account identity and
  security-stamp values.
- [Custom stores](guide/custom-stores.md): implement and verify the control-store contract.
- [Pruning and active modes](guide/operations.md): schedule bounded cleanup, apply retention
  safely, and list or end active modes from the server.
- [Route coverage review](guide/route-report.md): inspect the effective and raw routes in the host
  application.
- [Notes for code agents](guide/agents.md): wiring rules for agents integrating Masquerade into a
  host application.

The package is an early alpha distributed as GitHub prereleases and has not been published to a
package registry. Install the release tarball or a local build as described in the
[setup guide](guide/setup.md#generate-the-starter-files). The accepted v1 boundaries are
in the [development plan](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/design/DEVELOPMENT-PLAN.md),
the [technical specification](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/design/SPEC-masquerade.md),
and the [product requirements](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/design/PRD-masquerade.md).
See the [alpha baseline verification record](maintainers/alpha-baseline.md) for the pre-release baseline run. The
[maintainer records](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/docs/maintainers) contain further repository and verification guidance.
