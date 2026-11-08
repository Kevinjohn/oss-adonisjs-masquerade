# Decide who can support whom

The `policy` block in `config/masquerade.ts` decides who may start support mode, for which accounts,
and with what access. Each example below is a complete `policy` (plus any other config keys it
needs) and type-checks against `defineConfig<User, HttpContext>`. Replace the field names with your
own.

| Callback        | Required | Runs                                                      | `false` means                                                                            |
| --------------- | -------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `canMasquerade` | Yes      | At start and on every request during a mode               | Start denied (403), or the whole mode ends (409)                                         |
| `canEdit`       | No       | At an edit start and on every request during an edit mode | Edit start denied (403), or the edit mode ends (409); without it every mode is view-only |
| `canUseRequest` | No       | At start and on every request during a mode               | Only this request is rejected (403)                                                      |

Only a literal `true` allows. A callback that throws returns 503 and leaves the mode unchanged.

**Never let an operator support an administrator or anyone with more access.** With edit access
they could change that account's permissions and grant themselves more. Refusing other operators as
targets is the recommended default; see
[allow operator targets for view access](#allow-operator-targets-for-view-access) for the
alternative.

## A boolean operator flag

The [starter-kit recipe](starter-kit.md) adds a `masquerade_operator` column:

```ts
policy: {
  canMasquerade: ({ actor, target }) =>
    Boolean(actor.user.masqueradeOperator) &&
    !target.user.masqueradeOperator &&
    Boolean(target.user.active),
},
```

Without `canEdit`, every mode is view-only: reads work, writes are blocked.

### Allow operator targets for view access

```ts
policy: {
  canMasquerade: ({ actor, target }) =>
    Boolean(actor.user.masqueradeOperator) && Boolean(target.user.active),
  canEdit: ({ actor, target }) =>
    Boolean(actor.user.masqueradeOperator) &&
    !target.user.masqueradeOperator &&
    Boolean(target.user.active),
},
```

The package does not enforce either rule; the host chooses. This variant lets an operator view
another operator's account, for example an Owner checking what an Admin sees, while `canEdit` still
refuses them.

- View access: one operator sees what another operator sees.
- Edit access carries more risk: one operator can act as another, and an audit trail that records
  only the effective user points at the wrong person. If you allow it, record both with
  [`masqueradeAuditFields`](../guide/audit.md).

## Roles: everyone views, leads edit

```ts
policy: {
  canMasquerade: ({ actor, target }) =>
    ['support', 'support_lead'].includes(actor.user.role) &&
    target.user.role === 'customer' &&
    Boolean(target.user.active),
  canEdit: ({ actor, target }) =>
    actor.user.role === 'support_lead' && target.user.role === 'customer',
},
```

The operator chooses **View only** or **Can edit** when starting. An edit start by a `support`
operator is denied; a view start still works.

If a lead is demoted during an edit mode, the next request fails `canEdit` and the mode ends. Add
`role` to the [security stamp](end-modes-on-account-changes.md) as well, so a role change also ends
view-only modes, which never run `canEdit`.

## Teams: support only customers in your team

```ts
policy: {
  canMasquerade: ({ actor, target }) =>
    actor.user.role === 'support' &&
    target.user.role === 'customer' &&
    // Two accounts without a team are not in the same team.
    actor.user.teamId != null &&
    actor.user.teamId === target.user.teamId,
  // Team-scoped URLs such as /teams/:teamId/invoices must belong to the customer's team.
  canUseRequest: ({ target, request }) =>
    request.params.teamId === undefined || request.params.teamId === String(target.user.teamId),
},
```

`canMasquerade` is account-wide: when it turns false, the mode ends. `canUseRequest` is per
request: a `false` rejects only that request, and the operator can keep using other pages. It
receives the `HttpContext` as `request`. It does not run on ordinary requests while nobody is
masquerading, so keep normal tenant checks in your own middleware.

## Only with an open ticket, a reason and a short window

```ts
import db from '@adonisjs/lucid/services/db'

export default defineConfig<User, HttpContext>({
  // ...authority, store, contextEnforcement, retention
  reason: 'required',
  durationSeconds: 600, // default length: 10 minutes
  maxDurationSeconds: 1800, // longest an operator may request: 30 minutes
  policy: {
    canMasquerade: async ({ actor, target }) => {
      if (actor.user.role !== 'support' || target.user.role !== 'customer') return false
      const ticket = await db
        .from('support_tickets')
        .where('customer_id', target.id)
        .where('assignee_id', actor.id)
        .where('status', 'open')
        .first()
      return Boolean(ticket)
    },
  },
})
```

Closing the ticket ends the mode on the next request. `canMasquerade` runs on every request during
a mode, so keep the query indexed and cheap. `reason` is passed only at start; it is not available
to later checks. The reason is stored in the audit ledger, never shown in status.

## Check a policy in tests

With the [`masquerading()` test helper](../guide/testing.md), a denied start fails the request
before it is sent:

```ts
await assert.rejects(
  () => client.get('/dashboard').loginAs(operator).masquerading(colleague),
  /start control returned 403/
)

// View-only operators are blocked on writes.
const response = await client
  .post('/notes')
  .withCsrfToken()
  .loginAs(operator)
  .masquerading(customer, { access: 'view' })
response.assertStatus(403)
```

Full callback rules: [Configure persistent identity and policy](../guide/setup.md#configure-persistent-identity-and-policy).
