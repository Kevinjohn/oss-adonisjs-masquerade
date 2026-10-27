# Same-origin JSON browser client

The [native-session example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/native-session) includes a runnable JSON client at `/support/json`. It uses the same fictional operator and customers as the Edge workflow. V1 remains session authenticated: the browser sends the host session cookie, Shield CSRF token, and a captured `X-Masquerade-Context` with every unsafe request. There is no bearer token or cross-origin setup.

With Node 24 and pnpm, build and pack the repository library, then run the example. The local SQLite fixture is only for development:

```sh
nvm use
pnpm install
pnpm build
pnpm pack:fixture
cd examples/native-session
pnpm install --no-frozen-lockfile
cp .env.example .env
node ace generate:key
node ace migration:run
node ace demo:seed
pnpm dev
```

Sign in as `operator@example.test` with the demo password from `app/services/demo_accounts.ts`, then open `/support/json`. The page shell is served through raw `web` authentication. It embeds Shield's `csrfToken` and the eligible fictional customer choices. The [client source](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/native-session/resources/js/demo_json.js) uses `fetch` with `credentials: 'same-origin'`, `Accept: application/json`, and `cache: 'no-store'`:

```js
const response = await fetch('/masquerade/start', {
  method: 'POST',
  credentials: 'same-origin',
  cache: 'no-store',
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-CSRF-TOKEN': csrfToken,
    'X-Masquerade-Context': idleStatus.contextToken,
  },
  body: JSON.stringify({ targetId: customerId, reason: 'Customer requested help', access: 'edit' }),
})
```

The canonical raw controls are `GET /masquerade`, `POST /masquerade/start`, and `POST /masquerade/stop`. The start payload may include `access: 'view' | 'edit'`; omitting it selects view. An active `ModeView` includes its fixed `access` value, while an idle view omits the field. A start response carries a new token and a fixed `expiresAt`; an idle stop response carries another token. The host's `GET /support/json/customer` uses `web_effective` and returns actor and customer labels, the admitted context and deadline, and the customer's saved preference. `POST /support/json/customer/preference` requires effective admission, `allowMutation()`, the customer's Bouncer ability, an exact `emailUpdates` value of `"0"` or `"1"`, Shield CSRF, and the context header. It returns the confirmed preference. During view mode, the preference request is blocked even though its route is marked for mutation. In edit mode, the host's `canEdit` policy and the customer's Bouncer ability must both allow it. `POST /support/json/customer/sensitive` uses `sensitive()` and returns 403 during an active mode without touching customer data.

For example, a successful customer read resembles:

```json
{
  "actor": { "id": 1, "email": "operator@example.test" },
  "customer": { "id": 2, "fullName": "Customer One", "email": "customer-one@example.test" },
  "mode": {
    "contextToken": "1.<nonce>",
    "expiresAt": "2026-10-21T14:30:00.000Z",
    "access": "edit"
  },
  "emailUpdates": false,
  "canEdit": true
}
```

The client checks HTTP status and content type before decoding and uses manual redirect handling. A native authentication or Shield failure may redirect to HTML instead of returning a package error; the client asks the operator to reload the shell for a new CSRF token and sign in again if needed. It handles 401/419 authentication or CSRF recovery, 403 admission or sensitive denial, 422 invalid input, 429 with `Retry-After`, and 503 unavailable or uncertain outcomes. Missing context gives 428; a stale context or expired mode gives 409. Both leave the old mutation unapplied. On any uncertain outcome, the client reads fresh raw status and customer data where effective admission succeeds, clears old drafts, and requires a new click or submission. It never updates a token and silently replays the old request.

A blocked-action error uses `{ errors: [{ code, message, blockedBy }] }`, where `blockedBy` is `sensitive`, `view_only`, or `mutation_not_allowed`. The host owns the message and response handling. Raw status reports stored mode and its active `access`; it does not grant customer permission. The client freezes customer actions at the exact fixed deadline while keeping raw stop available for a stored expired mode. It checks status when a tab becomes visible and ignores late responses from an older context generation. A browser abort cannot undo work the server admitted. Raw status and stop remain available even when an effective customer read fails, so the operator can recover. For the underlying control and error contract, see [Usage](../usage.md) and [Security](../security.md).
