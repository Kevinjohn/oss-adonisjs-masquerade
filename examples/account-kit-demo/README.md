# Account Kit support demo

This local demo shows an operator signing in with Account Kit, entering Masquerade support mode
for a fictional customer, and returning to their own account. It uses Account Kit session
authentication, SQLite, and database-backed sessions.

## Start the demo

From the repository root, use Node.js 24 and pnpm, then install the repository dependencies:

```sh
nvm use
pnpm install
pnpm demo:account-kit
```

The first run needs network access to download the pinned Account Kit `0.1.3` GitHub release
artifact. The launcher builds Masquerade from this checkout, prepares the local app, and starts it
at <http://127.0.0.1:3335>. Wait for the `Account Kit demo ready` message before opening the URL;
the launcher prints the sign-in details after the app responds successfully. Keep the command
running while you use the demo.

Sign in with the fictional local operator account:

| Email                   | Password             |
| ----------------------- | -------------------- |
| `operator@example.test` | `demo-operator-2026` |

## Try the support workflow

1. Sign in at `/login` with the operator account above.
2. In the support workspace, choose **Customer One**, enter the reason `Review email preferences`,
   and start support mode. It starts as **View only**. The workspace
   identifies the operator as the actor and Customer One as the effective customer.
3. Open the customer's preference and try to change it. View-only mode rejects the change. Stop
   support mode, choose Customer One again, enter `Reverse preference change`, and start it with
   **Can edit**. Change the preference; it is saved for that customer and can be
   changed back.
4. While support mode is active, open **Your account** and try to change the operator's display
   name. Account Kit blocks the update while the operator is acting for a customer. Stop support
   mode and retry; the display-name change then succeeds. Enter the operator's current password
   each time you save a display-name change.
5. Select **Log out** when finished.

JavaScript must be enabled for Account Kit login, logout, and display-name forms. The support
workspace itself uses native forms.

## Local files and reset

The launcher creates a persistent workspace at `tmp/account-kit-demo/`. The generated application
is in `tmp/account-kit-demo/app/`; its environment file is `tmp/account-kit-demo/app/.env`, and
its SQLite database is `tmp/account-kit-demo/app/tmp/db.sqlite3`. The launcher creates `.env` only
on first setup, so your local settings remain in place on later runs.

Stop the server with **Ctrl+C**. Run `pnpm demo:account-kit` again to restart it. The database and
your changes persist. On restart, the seed step restores admission for the three reserved demo
accounts if needed, while preserving existing user rows, including edited display names.

To return to the original accounts and data, stop the server and run:

```sh
pnpm demo:account-kit --reset
```

This removes the demo SQLite database files. The same command creates a fresh database, seeds the
original fictional accounts, and starts the demo. It keeps the workspace and `.env`.

If the first setup is interrupted before the launcher writes `tmp/account-kit-demo/recipe.json`,
it will report an unrecognized workspace on the next run. Inspect `tmp/account-kit-demo/` and
deliberately move or remove that directory before retrying. The launcher does not clear an
unmarked directory for you.

This recipe is for local development only. It binds to localhost and uses public fictional
credentials; do not expose it to a network or use it as a production deployment.
