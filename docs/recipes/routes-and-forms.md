# Mark routes and forms

Every customer-facing route goes behind the effective guard. Masquerade then decides what an
operator may do there, and every form on those routes carries a context token.

## Pick a marker for each route

| Route does                                        | Marker            | View mode | Edit mode |
| ------------------------------------------------- | ----------------- | --------- | --------- |
| Reads (`GET`, `HEAD`)                             | none              | Allowed   | Allowed   |
| Ordinary writes support may do for the customer   | `allowMutation()` | 403       | Allowed   |
| Writes support should not do                      | none              | 403       | 403       |
| Password, email, 2FA, API keys, billing, deletion | `sensitive()`     | 403       | 403       |

```ts
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { allowMutation, sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router.get('orders', [controllers.Orders, 'index'])
    router.post('orders/:id/notes', [controllers.OrderNotes, 'store']).use(allowMutation())
    router.post('orders/:id/refund', [controllers.Refunds, 'store'])
    router.put('account/password', [controllers.Password, 'update']).use(sensitive())
  })
  .use(middleware.auth({ guards: ['web_effective'] }))
```

During a mode, these routes answer:

| Request                         | Response                                                             |
| ------------------------------- | -------------------------------------------------------------------- |
| Any write in view mode          | `403 E_MASQUERADE_ACTION_BLOCKED`, `blockedBy: view_only`            |
| Refund in edit mode (no marker) | `403 E_MASQUERADE_ACTION_BLOCKED`, `blockedBy: mutation_not_allowed` |
| Password in any mode            | `403 E_MASQUERADE_ACTION_BLOCKED`, `blockedBy: sensitive`            |
| Order note in edit mode         | Your handler runs as the customer                                    |

The markers change nothing for a customer using their own account. Your handler's normal checks
still apply: `auth.user` and Bouncer see the customer, so support can never do more than the
customer could. URL names do not make a route sensitive; mark each one.

Operator pages, login, signup and logout stay on the raw guard:

```ts
router.post('logout', [controllers.Session, 'destroy']).use(middleware.auth({ guards: ['web'] }))
```

## Add the context token to every form

With `contextEnforcement: 'enforce'`, every `POST`, `PUT`, `PATCH` and `DELETE` to an effective-guard
route needs the token, **even when nobody is masquerading**. Without it, the request gets
`428 E_MASQUERADE_CONTEXT_REQUIRED`. The token stops a form rendered for one customer from acting
on another after the mode changes in a different tab.

### Edge

The banner status middleware (`--banner`) shares `masquerade` with every view on effective routes:

```edge
@form({ route: 'order_notes.store', routeParams: { id: order.id }, method: 'POST' })
  <input type="hidden" name="_masqueradeContext" value="{{ masquerade.contextToken }}" />
  <textarea name="body" required></textarea>
  <button type="submit">Add note</button>
@end
```

Without the status middleware, call `await shareMasquerade(ctx)` from
`@kevinjohn/adonisjs-masquerade/http` in the controller before rendering; it shares the same
`masquerade` value.

### fetch, Inertia, React, Vue

Send the token captured when the form was rendered as the `X-Masquerade-Context` header:

```ts
await fetch(`/orders/${orderId}/notes`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-TOKEN': csrfToken,
    'X-Masquerade-Context': contextToken, // captured with this form, not re-fetched
  },
  body: JSON.stringify({ body }),
})
```

Never fetch a fresh token and retry a rejected request automatically: that replays the old intent
against whatever mode is now active. Show the error, refresh, and let the person act again. The
[JSON](../guide/clients/json.md), [React](../guide/clients/react.md) and
[Vue](../guide/clients/vue.md) guides show complete clients.

## Roll out in an app that already has forms

1. Set `contextEnforcement: 'report'` in `config/masquerade.ts`. Requests without a valid token
   still run, and each one logs a warning with its `code` and `route`.
2. Add the token to forms and clients, starting with the routes in those warnings.
3. When the warnings stop, set `contextEnforcement: 'enforce'`.

`report` does not protect anyone; it only tells you which forms are missing the token.

## Check every route

```sh
node ace masquerade:routes
```

Customer routes appear under `web_effective` as `BUSINESS`, with their markers. Anything under the
raw guard as `RAW-GUARD BUSINESS` should be an operator page or login/logout. `UNCLASSIFIED` routes
have no auth guard and run no mode checks: each should be genuinely public, or move under
`web_effective`. See [route coverage review](../guide/route-report.md).

## Test the markers

```ts
test('support cannot change a customer password', async ({ client }) => {
  const response = await client
    .put('/account/password')
    .json({ password: 'new-password' })
    .withCsrfToken()
    .loginAs(operator)
    .masquerading(customer, { access: 'edit' })

  response.assertStatus(403)
  response.assertBodyContains({
    errors: [{ code: 'E_MASQUERADE_ACTION_BLOCKED', blockedBy: 'sensitive' }],
  })
})
```

`masquerading()` adds the context token itself. See [testing your routes](../guide/testing.md).
