# End support when an account changes

A support mode should end when either account's security changes: a password reset, a suspension,
a role change, or a "sign out everywhere". Masquerade does this through the **security stamp**:
the values listed in `securityStamp` are captured when the mode starts and compared on every
request. If they differ for the operator or the customer, the mode ends.

The [starter-kit recipe](starter-kit.md) uses:

```ts
securityStamp: stampFrom<User>((user) => [
  user.password,
  user.masqueradeOperator,
  user.active,
  user.securityStamp,
]),
```

With that stamp, these changes were checked against a running app:

| Change to the customer or operator   | Active mode |
| ------------------------------------ | ----------- |
| New password (`user.password = ...`) | Ends        |
| Suspended (`user.active = false`)    | Ends        |
| Operator flag changed                | Ends        |
| New `security_stamp` value           | Ends        |
| Email or name changed                | Continues   |

When a mode ends this way, the operator's next customer request gets
`409 E_MASQUERADE_CONTEXT_CHANGED` and status reads idle. The operator starts again if they still
need access.

## End support for one account on demand

Write a new value to the stamp column. Use this for "sign out everywhere", a security incident, or
any change the stamp does not already cover:

```ts
import { randomUUID } from 'node:crypto'

user.securityStamp = randomUUID()
await user.save()
```

Do it in the same transaction as the change it belongs to, so the two cannot drift apart.

## Cover permissions stored elsewhere

The stamp sees only the values you list. A role in a `roles` table, a permission cache or an
external identity provider is invisible to it. Either add the value:

```ts
securityStamp: stampFrom<User>((user) => [
  user.password,
  user.active,
  user.role, // a column on users
  user.securityStamp,
]),
```

or write a new `security_stamp` whenever that other source changes. Selected values must be loaded
on the user the auth provider returns; an `undefined` value throws instead of hiding a change.

## End a mode from the server

For an operator account you suspect is compromised, or a mode started by mistake:

```sh
node ace masquerade:status          # list active modes
node ace masquerade:stop --actor=42 # end operator 42's mode
node ace masquerade:stop --all --force
```

`masquerade:stop` ends the mode only. To sign the operator out as well, write a new stamp and use
your own session controls. See [see and end active modes](../guide/operations.md#see-and-end-active-modes).

## Test it

```ts
import { randomUUID } from 'node:crypto'

test('a new security stamp ends the mode', async ({ client }) => {
  const operator = await User.create({
    email: 'operator@example.test',
    password: 'operator-password',
    masqueradeOperator: true,
  })
  const customer = await User.create({
    email: 'customer@example.test',
    password: 'customer-password',
  })

  const idle = await client
    .get('/masquerade')
    .header('accept', 'application/json')
    .loginAs(operator)
  await client
    .post('/masquerade/start')
    .header('accept', 'application/json')
    .header('x-masquerade-context', idle.body().contextToken)
    .json({ targetId: customer.id })
    .withCsrfToken()
    .loginAs(operator)

  customer.securityStamp = randomUUID()
  await customer.save()

  const response = await client
    .get('/dashboard')
    .header('accept', 'application/json')
    .loginAs(operator)
  response.assertStatus(409)
  response.assertBodyContains({ errors: [{ code: 'E_MASQUERADE_CONTEXT_CHANGED' }] })
})
```

The `masquerading()` helper starts and stops around one request, so this test drives the control
routes directly to change the account between requests.

More detail: [choosing stamp fields](../guide/setup.md#configure-persistent-identity-and-policy)
and [custom authorities](../guide/custom-authorities.md).
