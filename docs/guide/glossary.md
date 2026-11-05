# Terms

The words the guides use, in the order you meet them.

- **Operator** (or **actor**): The signed-in person providing support. Stays signed in as themselves for the whole mode.
- **Customer** (or **target**): The account the operator supports. Never signs in, receives no credential, and does not gain the operator's permissions.
- **Support mode** (or **mode**): The period during which the operator sees customer pages as the customer. One per operator account, shared by all their sessions and tokens, with a fixed deadline (15 minutes by default, at most one hour). It ends at the deadline, on Stop, or when the policy or a security stamp no longer allows it.
- **Raw guard** (`web`): The normal AdonisJS session guard. Always returns the operator. Use it for login, logout, operator pages and the start/stop controls.
- **Effective guard** (`web_effective`): A wrapper around the raw guard. While a mode is active it returns the customer as `auth.user`; otherwise it returns the signed-in user. Use it for every customer-facing route. Configure makes it the default guard.
- **Access level**: `view` (default) blocks every write. `edit` allows writes on routes marked `allowMutation()`, and only when `canEdit` returns `true`. Chosen at start and fixed until Stop.
- **`allowMutation()`**: Route marker: this write may run in edit mode. Without it, writes are blocked during any mode.
- **`sensitive()`**: Route marker: always blocked during a mode, in any access level. Use it for passwords, email, 2FA, API keys, billing and account deletion.
- **Policy**: The `canMasquerade`, `canEdit` and `canUseRequest` callbacks in `config/masquerade.ts`. You write them; only a literal `true` allows. See [Decide who can support whom](../recipes/who-can-masquerade.md).
- **Admission**: The check Masquerade runs on every customer-route request during a mode: deadline, policy, security stamps and route markers. A failure rejects the request; some failures end the mode.
- **Context token**: A short value returned by status, start and stop, and changed by every start and stop. Each form or client request sends the token it was rendered with (`_masqueradeContext` field or `X-Masquerade-Context` header). If the mode changed since, the request is rejected instead of acting on the wrong customer. It is not a credential and does not replace CSRF.
- **`report` / `enforce`**: `contextEnforcement` setting. `enforce` rejects writes to customer routes without a current token (428 or 409). `report` lets them through and logs a warning; use it only while adding tokens to an existing app. See [Mark routes and forms](../recipes/routes-and-forms.md).
- **Security stamp**: Values from the account, such as the password hash and active flag, captured when a mode starts and compared on every request. A change for either account ends the mode. See [End support when an account changes](../recipes/end-modes-on-account-changes.md).
- **Incarnation**: A value that tells apart two accounts that ever had the same ID. `'id'` is correct when your database never reuses IDs; otherwise store an immutable value per account.
- **Namespace**: A name for this identity domain, such as `my_app`. Modes and audit rows are stored per namespace. Set once with `--namespace` and do not change it.
- **Control routes**: `GET /masquerade` (status), `POST /masquerade/start` and `POST /masquerade/stop`. Mounted on the raw guard with separate rate limits.
- **Control store**: Where modes and the audit ledger live. The generated config uses the Lucid store (`masquerade_modes` and `masquerade_events` tables).
