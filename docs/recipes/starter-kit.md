# Add support mode to a new AdonisJS app

This recipe takes the official AdonisJS 7 Hypermedia starter kit from `pnpm create adonisjs` to a
working support mode: a support page where an operator picks a customer, a banner with a Stop
button on customer pages, and a test that proves both. Every file below was applied to a fresh
starter kit and passed its typecheck and tests.

For the Inertia React or Vue starter kits, follow steps 1–5, then build the support page and banner
with the [React](../guide/clients/react.md) or [Vue](../guide/clients/vue.md) client guide. For an
older application, read [Install and configure](../guide/setup.md) next to this recipe.

## What you change

| File                                            | Change                                       |
| ----------------------------------------------- | -------------------------------------------- |
| `database/migrations/*_alter_users_table.ts`    | New: three columns on `users`                |
| `config/masquerade.ts`                          | Replace the generated placeholders           |
| `start/routes.ts`                               | Move logout to the raw guard, add `/support` |
| `app/controllers/support_controller.ts`         | New: the operator's support page             |
| `resources/views/pages/support.edge`            | New: customer chooser, start and stop forms  |
| `resources/views/components/layouts/app.edge`   | Include the generated banner                 |
| `app/controllers/masquerade_form_controller.ts` | Set where start and stop redirect            |
| `database/seeders/support_accounts_seeder.ts`   | New: a local operator and customer           |
| `config/database.ts`                            | A separate SQLite file for tests             |
| `tests/bootstrap.ts`, `tests/functional/*.ts`   | API client plugins and a support-mode test   |

## Step 1: Install

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/download/v0.1.5/kevinjohn-adonisjs-masquerade-0.1.5.tgz
node ace add @adonisjs/limiter
node ace configure @kevinjohn/adonisjs-masquerade --namespace=my_app --guard=web --banner --form-controller
```

The starter kit has no rate limiter, and configure only mounts the control routes when one exists.
Choose the `database` store when `node ace add` asks; a script can run
`pnpm add @adonisjs/limiter && node ace configure @adonisjs/limiter --store=database` instead.

On the starter kit, configure:

- makes `web_effective` the default guard in `config/auth.ts`, next to the raw `web` guard;
- adds the context middleware after `initialize_auth` and the banner status middleware after
  `silent_auth` in `start/kernel.ts`;
- mounts `GET /masquerade`, `POST /masquerade/start` and `POST /masquerade/stop` on the raw guard
  with separate start and stop limiters;
- generates the banner component, the form controller, `config/masquerade.ts` and the Masquerade
  tables migration.

Until step 3 is done, every page behind `middleware.auth()` returns 503. The generated config fails
closed on purpose.

## Step 2: Add the account columns

Masquerade needs to know who may support customers, whether an account is active, and a value you
can change to end support for an account. Generate an alter migration:

```sh
node ace make:migration users --alter
```

Replace its contents:

```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Who may start support mode. Nobody until you switch it on.
      table.boolean('masquerade_operator').notNullable().defaultTo(false)
      // Inactive accounts can neither use nor receive support mode.
      table.boolean('active').notNullable().defaultTo(true)
      // Write a new value to end every support mode that involves this account.
      table.string('security_stamp', 64).notNullable().defaultTo('initial')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('security_stamp')
      table.dropColumn('active')
      table.dropColumn('masquerade_operator')
    })
  }
}
```

Run both migrations:

```sh
node ace migration:run
```

The starter kit's `User` model extends the generated `database/schema.ts`, which `migration:run`
rewrites, so `user.masqueradeOperator`, `user.active` and `user.securityStamp` exist without editing
the model.

## Step 3: Configure identity and policy

Replace `config/masquerade.ts`:

```ts
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import UserModel from '#models/user'
import { Database } from '@adonisjs/lucid/database'
import { defineConfig } from '@kevinjohn/adonisjs-masquerade'
import { sessionAuthority, stampFrom } from '@kevinjohn/adonisjs-masquerade/native'
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
import { userProvider } from '#services/masquerade_user_provider'

type User = InstanceType<typeof UserModel>

const nativeAdapter = sessionAuthority<User>({
  namespace: 'my_app',
  guard: 'web',
  provider: userProvider,
  // Auto-increment IDs that are never reused identify the account on their own.
  incarnation: 'id',
  // A change to any of these values ends every mode that involves the account.
  securityStamp: stampFrom<User>((user) => [
    user.password,
    user.masqueradeOperator,
    user.active,
    user.securityStamp,
  ]),
  isActive: (user) => Boolean(user.active),
})

export { nativeAdapter }

export default defineConfig<User, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    // Operators may support active customers, never another operator.
    canMasquerade: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) &&
      !target.user.masqueradeOperator &&
      Boolean(target.user.active),
    // Delete canEdit to make every support mode view-only.
    canEdit: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) &&
      !target.user.masqueradeOperator &&
      Boolean(target.user.active),
  },
  store: async () => {
    const database = await app.container.make(Database)
    return new LucidControlStore(database.connection())
  },
  contextEnforcement: 'enforce',
  reason: 'optional',
  retention: 'host-managed',
})
```

- `incarnation: 'id'` is safe because SQLite `AUTOINCREMENT` and PostgreSQL sequences never hand
  out a deleted ID again. If your database can reuse IDs, see
  [identity and policy](../guide/setup.md#configure-persistent-identity-and-policy).
- `contextEnforcement: 'enforce'` is safe here because the starter kit has no forms on customer
  pages yet. In an app that already has them, start with `'report'`; see
  [Mark routes and forms](routes-and-forms.md).
- For other rules, such as roles, teams or an open ticket, see
  [Decide who can support whom](who-can-masquerade.md).

## Step 4: Put routes on the right guard

The default guard is now `web_effective`: on customer pages, `auth.user` is the customer while a
mode is active. Operator pages and logout must use the raw `web` guard so they always see the
operator. In `start/routes.ts`, replace the starter's authenticated group:

```ts
// Customer-facing pages: the default guard is now web_effective.
router
  .group(() => {
    router.on('/dashboard').render('pages/dashboard').as('dashboard')
  })
  .use(middleware.auth())

// Operator-only pages stay on the raw web guard, so they always see the operator.
router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy'])
    router.get('support', [controllers.Support, 'index']).as('support')
  })
  .use(middleware.auth({ guards: ['web'] }))
```

`controllers.Support` appears in `#generated/controllers` once the controller below exists and
`pnpm dev` or `node ace codegen` has run.

## Step 5: Build the support page

`app/controllers/support_controller.ts`:

```ts
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class SupportController {
  /** The operator's support page: current mode, customer chooser and start form. */
  async index(ctx: HttpContext) {
    const operator = ctx.auth.use('web').getUserOrFail()
    const runtime = await ctx.containerResolver.make('masquerade.runtime')
    const mode = await runtime.service.status(ctx)

    // Offer only accounts the policy would accept. The policy still checks the submitted ID.
    const customers = operator.masqueradeOperator
      ? await User.query()
          .where('masquerade_operator', false)
          .where('active', true)
          .orderBy('email')
          .limit(50)
      : []

    return ctx.view.render('pages/support', { mode, customers })
  }
}
```

`resources/views/pages/support.edge`:

```edge
@layouts.app({ title: 'Support' })
  @page()
    @if(mode.isMasquerading)
      <p>You are supporting account {{ mode.targetId }} until {{ mode.expiresAt }}.</p>
      @form({ route: 'masquerade.stop', method: 'POST' })
        <input type="hidden" name="_masqueradeContext" value="{{ mode.contextToken }}" />
        <button type="submit" class="btn btn--primary">Stop support mode</button>
      @end
    @elseif(customers.length)
      @form({ route: 'masquerade.start', method: 'POST' })
        <input type="hidden" name="_masqueradeContext" value="{{ mode.contextToken }}" />
        <label for="targetId">Customer</label>
        <select id="targetId" name="targetId" required>
          @each(customer in customers)
            <option value="{{ customer.id }}">{{ customer.fullName || customer.email }}</option>
          @end
        </select>
        <label for="reason">Reason (optional)</label>
        <input id="reason" name="reason" maxlength="500" />
        <label>
          <input type="radio" name="access" value="view" checked />
           View only
        </label>
        <label>
          <input type="radio" name="access" value="edit" />
           Can edit
        </label>
        <button type="submit" class="btn btn--primary">Start support mode</button>
      @end
    @else
      <p>No customers are available for support.</p>
    @end
  @end
@end
```

Each form carries the context token from the status it was rendered with, and `@form` adds the
CSRF field. If the mode changes in another tab, the old form is rejected with 409 rather than
acting on the wrong customer.

In `app/controllers/masquerade_form_controller.ts`, set where the forms land:

```ts
  protected redirectAfterStart(_ctx: HttpContext): string {
    return '/dashboard'
  }

  protected redirectAfterStop(_ctx: HttpContext): string {
    return '/support'
  }

  // ...

  protected errorPath(_ctx: HttpContext, _action: FormAction): string {
    return '/support'
  }
```

## Step 6: Show the banner

In `resources/views/components/layouts/app.edge`, include the generated banner as the first child
of `<body>`:

```edge
<body>
  @include('components/masquerade/banner')
</body>
```

On customer pages during a mode it shows the account, access level, deadline and a Stop button.
The file is yours to restyle; it renders nothing on operator pages or while idle.

## Step 7: Make an operator and try it

`database/seeders/support_accounts_seeder.ts` creates one operator and one customer for local use:

```ts
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

/** Local accounts for trying support mode. Never runs in production. */
export default class extends BaseSeeder {
  static environment = ['development']

  async run() {
    await User.updateOrCreate(
      { email: 'operator@example.test' },
      { fullName: 'Support Operator', password: 'operator-password', masqueradeOperator: true }
    )
    await User.updateOrCreate(
      { email: 'customer@example.test' },
      { fullName: 'Example Customer', password: 'customer-password' }
    )
  }
}
```

```sh
node ace db:seed
pnpm dev
```

Sign in as `operator@example.test` / `operator-password`, open `/support`, pick Example Customer and
start. You land on `/dashboard` as the customer, with the banner. Stop returns you to `/support`.
In production, set `masquerade_operator` through your own admin tooling.

## Step 8: Test it

The starter kit's tests use the development database, and `truncate()` empties it after each test.
Give tests their own SQLite file in `config/database.ts` so they keep your seeded accounts:

```ts
connection: {
  filename: app.tmpPath(app.inTest ? 'test.sqlite3' : 'db.sqlite3'),
},
```

Install the API client and register its plugins in `tests/bootstrap.ts`:

```sh
pnpm add -D @japa/api-client
```

```ts
import { apiClient } from '@japa/api-client'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import { shieldApiClient } from '@adonisjs/shield/plugins/api_client'
import { masqueradeApiClient } from '@kevinjohn/adonisjs-masquerade/plugins/api_client'

export const plugins: Config['plugins'] = [
  // ...the starter kit's plugins
  apiClient(),
  sessionApiClient(app),
  authApiClient(app),
  shieldApiClient(),
  masqueradeApiClient(),
]
```

`tests/functional/support_mode.spec.ts`:

```ts
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'

test.group('Support mode', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('an operator opens the dashboard as a customer', async ({ client }) => {
    const operator = await User.create({
      email: 'operator@example.test',
      password: 'operator-password',
      masqueradeOperator: true,
    })
    const customer = await User.create({
      email: 'customer@example.test',
      password: 'customer-password',
    })

    const response = await client.get('/dashboard').loginAs(operator).masquerading(customer)

    response.assertStatus(200)
    response.assertTextIncludes(`You are viewing as account ${customer.id}`)
  })

  test('an operator cannot support another operator', async ({ client, assert }) => {
    const operator = await User.create({
      email: 'operator@example.test',
      password: 'operator-password',
      masqueradeOperator: true,
    })
    const colleague = await User.create({
      email: 'colleague@example.test',
      password: 'colleague-password',
      masqueradeOperator: true,
    })

    await assert.rejects(
      () => client.get('/dashboard').loginAs(operator).masquerading(colleague),
      /start control returned 403/
    )
  })
})
```

```sh
node ace test functional
```

Use `truncate()`, not `withGlobalTransaction()`, between tests: on SQLite, requests that read the
Masquerade tables wait forever inside a global transaction.

## Step 9: Check route coverage

```sh
node ace masquerade:routes
```

```text
[ info ] unprotected
  GET,HEAD           / [UNCLASSIFIED READ]
  GET,HEAD           /signup [UNCLASSIFIED READ]
  POST               /signup [UNCLASSIFIED MUTATION]
  GET,HEAD           /login [UNCLASSIFIED READ]
  POST               /login [UNCLASSIFIED MUTATION]
[ info ] web
  POST               /logout [RAW-GUARD BUSINESS MUTATION]
  GET,HEAD           /support [RAW-GUARD BUSINESS READ]
  GET,HEAD           /masquerade [CONTROL READ]
  POST               /masquerade/start [CONTROL MUTATION]
  POST               /masquerade/stop [CONTROL MUTATION]
[ info ] web_effective
  GET,HEAD           /dashboard [BUSINESS READ]
```

Public pages are `UNCLASSIFIED`, operator pages are `RAW-GUARD BUSINESS`, and customer pages are
`BUSINESS`. Every page you add for customers belongs under `web_effective`. See
[route coverage review](../guide/route-report.md) for each label.

## Next

- [Mark routes and forms](routes-and-forms.md) as you add customer pages.
- [End support when an account changes](end-modes-on-account-changes.md).
- [Alert on masquerade activity](../guide/alerts.md) and [audit business work](../guide/audit.md).
