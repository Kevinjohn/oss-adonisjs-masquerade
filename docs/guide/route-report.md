# Review the route coverage report

The [API entry-point map](../api-reference.md#supported-package-imports) links the report command
under `adonisjs-masquerade/commands` and the `sensitive` and `allowMutation` markers under
`adonisjs-masquerade/http`.

Run the Ace report after routes and middleware have been registered:

```sh
node ace masquerade:routes
```

The report groups routes by matched authentication guard and shows the request method, route markers,
and a coverage label. It is a review aid, not a boot-time registry or an enforcement mechanism. It
does not establish what an arbitrary host handler or middleware does.

For Account Kit hosts, see the [integration preview](account-kit.md). Routes named `accountKit.*`
are reported as managed and blocked while active only after the integration provider verifies that
its global blocker is installed and the mounted routes match Account Kit's registration. If that
check is missing or unverified, those routes remain `UNCLASSIFIED` with a note. Do not treat a
managed-route label as proof that every route in the group is blocked: `accountKit.account.logout`
and `accountKit.auth.csrf` are exempt so logout and CSRF token retrieval remain available. Account
Kit's `except` option removes omitted endpoints from its registration, so they are not mounted by
Account Kit; the remaining registered routes stay covered by the blocker. A host-added
`accountKit.*` route absent from registration fails provider validation.

## Coverage labels

- `CONTROL` means the report positively recognized a Masquerade controller handler. Check that the
  route is mounted on the intended raw session guard and has the host protections required for that
  endpoint. A package control route behind an effective guard is flagged with a reminder to use the
  raw guard. The controller also fails closed with `E_MASQUERADE_UNAVAILABLE` if the selected guard
  is not raw.
- `POSSIBLE CONTROL (name-inferred; review handler)` means the host assigned an exact recognized
  route name such as `logout`, `auth.logout`, or `session.logout`. The report inferred intent from
  the name; it did not recognize the handler. A business or export handler with one of these names
  remains visible as a possible control until reviewed.
- `RAW-GUARD BUSINESS` means the route uses the raw actor guard or another non-effective guard and
  was not recognized as a control. Confirm that it is an intentional control or move business work
  behind the effective guard.
- `BUSINESS` means the route uses an effective guard. Review its `sensitive` and `allowMutation`
  markers against the operations it performs. `allowMutation()` identifies routes that may accept
  ordinary writes in edit mode; it does not grant edit access or target authorization. View mode
  blocks unsafe actions before route configuration is disclosed.
- `UNCLASSIFIED` means the route has no recognized auth guard metadata. Decide whether it should be
  public, authenticated with the effective guard, or an intentional raw-guard control.

The `unresolved handler` flag means a possible controller reference could not be loaded or resolved
by the report. The `unsupported mixed effective/non-effective guards` flag means one route lists
both kinds of guard. Resolve either case by inspecting the registered handler and route definition.

## Review procedure

For each `POSSIBLE CONTROL`, inspect the registered handler and confirm whether it is actually a
login, logout, signup, or other host control action. Do not rely on its route name or URL. Resolve
every effective-guard flag on a package control route by mounting it with its raw actor guard. For
each `RAW-GUARD BUSINESS` and `UNCLASSIFIED` entry, trace the handler and choose the intended guard
based on the work it performs. For every `CONTROL` entry, confirm the recognized package handler,
raw guard, and the host's route protections. Resolve unresolved and mixed-guard flags before
treating coverage review as complete.

The report does not change authentication behavior, validate arbitrary middleware semantics, or
prove that a route name describes its handler. Review the application route definitions and
middleware alongside the report as a release check.
