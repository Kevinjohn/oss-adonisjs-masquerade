# Review the route coverage report

The [API entry-point map](https://kevinjohn.github.io/oss-adonisjs-masquerade/reference/index#supported-package-imports) links the report command
under `@kevinjohn/adonisjs-masquerade/commands` and the `sensitive` and `allowMutation` markers under
`@kevinjohn/adonisjs-masquerade/http`.

Run the Ace report after routes and middleware have been registered:

```sh
node ace masquerade:routes
```

The report groups routes by matched authentication guard and shows the request method, route markers,
and a coverage label. It is a review aid, not a boot-time registry or an enforcement mechanism. It
does not establish what an arbitrary host handler or middleware does.

The report and the global Account Kit blocker use the same route-name rule. After the integration
provider verifies blocker installation and route registration, the report labels
`accountKit.account.logout` and `accountKit.auth.csrf` as `Account Kit managed (exempt)` and other
`accountKit.*` routes as `Account Kit managed (blocked while active)`. Before verification, the
report labels every `accountKit.*` route `UNCLASSIFIED` with a missing or unverified blocker note.
Account Kit's `except` option omits endpoints from both mounting and registration. A host-added
`accountKit.*` route absent from registration fails provider validation. See the
[integration preview](account-kit.md).

On a host-owned route, `(Account Kit blocker registered)` means the report resolved a named
middleware entry to the package's exact `AccountKitAccountBlocker` class. Custom aliases are
supported. For example:

```text
  PATCH              /account/profile [RAW-GUARD BUSINESS MUTATION] (Account Kit blocker registered)
```

Treat an unmarked host route as unverified for this blocker. Inspect wrappers and unresolved
middleware manually. The label confirms registration; review execution order and behaviour in the host.

## Coverage labels

- `CONTROL` means the report positively recognised a Masquerade controller handler. Check that the
  route is mounted on the intended raw session guard and has the host protections required for that
  endpoint. A package control route behind an effective guard is flagged with a reminder to use the
  raw guard. The controller also fails closed with `E_MASQUERADE_UNAVAILABLE` if the selected guard
  is not raw.
- `POSSIBLE CONTROL (name-inferred; review handler)` means the host assigned an exact recognised
  route name such as `logout`, `auth.logout`, or `session.logout`. The report inferred intent from
  the name; it did not recognise the handler. A business or export handler with one of these names
  remains visible as a possible control until reviewed.
- `RAW-GUARD BUSINESS` means the route uses the raw actor guard or another non-effective guard and
  was not recognised as a control. Confirm that it is an intentional control or move business work
  behind the effective guard.
- `BUSINESS` means the route uses an effective guard. Review its `sensitive` and `allowMutation`
  markers against the operations it performs. `allowMutation()` identifies routes that may accept
  ordinary writes in edit mode; it does not grant edit access or target authorisation. View mode
  blocks unsafe actions before route configuration is disclosed.
- `UNCLASSIFIED` covers routes without recognised auth guard metadata and Account Kit managed
  routes whose blocker is missing or unverified. For routes without recognised auth guard metadata,
  decide whether they should be public, authenticated with the effective guard, or an intentional
  raw-guard control. There the effective guard returns the actor and no mode checks run. See
  [security](security.md#authorisation-and-route-coverage).

The `unresolved handler` flag means a possible controller reference could not be loaded or resolved
by the report. The `unsupported mixed effective/non-effective guards` flag means one route lists
both kinds of guard. The `unsupported distinct effective credential transports` flag means one
route lists effective guards that wrap different raw guards, such as a session guard and an
access-token guard; give each route one effective guard. Resolve either case by inspecting the registered handler and route definition.

## Review procedure

For each `POSSIBLE CONTROL`, inspect the registered handler and confirm whether it is actually a
login, logout, signup, or other host control action. Do not rely on its route name or URL. Resolve
every effective-guard flag on a package control route by mounting it with its raw actor guard. For
each `RAW-GUARD BUSINESS` and `UNCLASSIFIED` entry, trace the handler and choose the intended guard
based on the work it performs. For every `CONTROL` entry, confirm the recognised package handler,
raw guard, and the host's route protections. Resolve unresolved and mixed-guard flags before
treating coverage review as complete.

The report does not change authentication behaviour, validate arbitrary middleware semantics, or
prove that a route name describes its handler. Review the application route definitions and
middleware alongside the report as a release check.
