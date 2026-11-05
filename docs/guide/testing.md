# Testing your routes

`@kevinjohn/adonisjs-masquerade/plugins/api_client` adds `masquerading()` to Japa API client requests, next to
`loginAs()` from `@adonisjs/auth`. It is for host route tests such as "a support agent viewing a
customer cannot reach billing".

Register the plugin after the auth, session and Shield API client plugins in `tests/bootstrap.ts`:

```ts
import { masqueradeApiClient } from '@kevinjohn/adonisjs-masquerade/plugins/api_client'

export const plugins: Config['plugins'] = [
  // assert(), pluginAdonisJS(app), apiClient(), authApiClient(app),
  // sessionApiClient(app), shieldApiClient(), ...
  masqueradeApiClient(),
]
```

Chain it after `loginAs()` with the operator. Unsafe session requests still need Shield's
`withCsrfToken()`, as without masquerade:

```ts
test('a support agent viewing a customer cannot change billing', async ({ client }) => {
  const response = await client
    .post('/billing/card')
    .json({})
    .withCsrfToken()
    .loginAs(agent)
    .masquerading(customer, { access: 'view' })

  response.assertStatus(403)
  response.assertBodyContains({
    errors: [{ code: 'E_MASQUERADE_ACTION_BLOCKED', blockedBy: 'view_only' }],
  })
})
```

Before the request is sent, the plugin:

1. reads the idle status from `GET /masquerade` as the `loginAs()` user;
2. starts the mode through `POST /masquerade/start` with the idle context token and a CSRF token,
   so the host's limiter, policy callbacks, security stamps and audit ledger all run;
3. adds the active context token as `X-Masquerade-Context` when the request method is not `GET`,
   `HEAD` or `OPTIONS`.

After the response, it reads the status again and stops the mode if it is still active. The next
request in the test is idle again.

`masquerading(target, options)` takes a target with an `id`, or the ID itself. The options are
`access` (`view` or `edit`), `reason`, `durationSeconds` and `prefix`. The control routes default to
`/masquerade`, as mounted by `masqueradeRoutes`; pass `masqueradeApiClient({ prefix })` or a
per-request `prefix` for another mount, such as `/api/masquerade` for access tokens.

If status, start or stop does not return a mode, the request fails with an error naming the control
and its status, for example `masquerading() start control returned 403`. The test never runs the
request unmasked by mistake. The start counts against the host's start limiter for that operator,
so a suite with a tight test limit should use a fresh operator per test.

The native-session example's `tests/functional/masquerading_helper.spec.ts` covers a view-only
denial, a `sensitive()` route, an allowed edit-mode mutation and a policy denial.

## Reset the database between tests

Use `testUtils.db().truncate()` rather than `withGlobalTransaction()`:

```ts
test.group('Support mode', (group) => {
  group.each.setup(() => testUtils.db().truncate())
})
```

On SQLite, a request that reads the Masquerade tables waits forever inside a global transaction,
and the test times out. `truncate()` empties the tables after each test. The AdonisJS starter kits
point tests at the development database, so give tests their own file in `config/database.ts`:

```ts
connection: {
  filename: app.tmpPath(app.inTest ? 'test.sqlite3' : 'db.sqlite3'),
},
```

The [starter-kit recipe](../recipes/starter-kit.md#step-8-test-it) shows a complete test setup, and
each recipe ends with a test for its task.
