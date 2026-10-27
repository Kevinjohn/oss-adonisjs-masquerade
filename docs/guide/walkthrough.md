# Add user impersonation to AdonisJS

Masquerade lets an authorized support operator investigate a customer-visible issue through the
customer's ordinary application view. The operator stays signed in, while the customer's normal
permissions decide what the support session can read or change. This gives support a way to reproduce
an issue in context without asking for the customer's password or creating a customer login.

This walkthrough follows the working [fictional native-session demo](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/736b5d9327b56dd90b1b506b07fa7bad0e7fbb9b/examples/native-session). It uses AdonisJS 7, Auth 10 and Session 8. The demo uses a seeded operator and two fictional customers; its local-only credentials and setup are in the [demo README](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/736b5d9327b56dd90b1b506b07fa7bad0e7fbb9b/examples/native-session/README.md).

## Try the support journey

Start the demo using its [local setup instructions](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/736b5d9327b56dd90b1b506b07fa7bad0e7fbb9b/examples/native-session/README.md), then sign in as the seeded operator and open the support workspace. In this example, Customer One asks for help understanding email-update preferences.

![The signed-in operator's support workspace with a customer chooser, reason field and access-level choice defaulting to View only.](../assets/walkthrough/support_workspace.png)

_The raw operator session offers only eligible customers. Enter a short, useful reason before starting; avoid secrets and unnecessary personal details._

Choose Customer One, select **Can edit** for this reversible preference task, enter “Customer
requested help with email settings”, and start support mode. View-only is the default; edit is
available only because the host's `canEdit` policy approves this operator and customer. The customer page shows both identities and the fixed deadline. The operator remains authenticated; Masquerade does not sign in as the customer.

![The customer view with a visible support banner naming the operator, effective customer, account-wide scope, Can edit access and deadline.](../assets/walkthrough/support_customer_active.png)

_The operator is the actor; Customer One is the effective identity for this business page. The
banner shows the edit access selected at start, the account-wide scope and the fixed deadline._

The current email-update setting is off. The demo permits this reversible preference change because the customer's ordinary authorization allows it. Save the change and confirm that the customer view now shows it on.

![Customer One's email-update preference after saving the reversible change.](../assets/walkthrough/support_preference_saved.png)

_The operator selected edit at start. The preference route also opts into ordinary mutation, and
the customer's normal permission check still applies._

Next, try the sensitive action. The application rejects it before its handler can run, and shows a recovery page with a route back to the raw support workspace. The functional journey also checks the stored preference after this denial, confirming that the sensitive request did not change it.

![The application's sensitive-action denial page with a clear route back to support controls.](../assets/walkthrough/support_sensitive_denied.png)

_A denial screen alone cannot prove that data stayed unchanged. The demo's functional test reads the database after the request and verifies the saved preference is still on._

Return to the support workspace and stop support mode. The idle page is again the operator's workspace, with the customer chooser ready for another authorized case.

![The idle support workspace after stopping support mode, with the operator identity and customer chooser visible.](../assets/walkthrough/support_stopped.png)

_Stopping returns the browser to the raw operator workspace. It does not change the customer's login or issue a customer credential._

## Identity, scope and boundaries

The native session guard continues to authenticate the operator on every request. On covered business routes, the effective guard resolves the selected customer, so the application's usual customer authorization applies. The operator's permissions are not combined with the customer's, and the customer does not log in. This walkthrough uses session transport; token configuration is covered in the [access-token guide](access-tokens.md).

Mode is stored server-side for the actor account and shared by valid integrated sessions. Every
start defaults to view-only; edit is selected at start and requires the host's `canEdit` policy.
The selected level applies across the account's integrated sessions and tokens. The default deadline
is 15 minutes, with a one-hour maximum; an application may choose shorter limits. Later requests do not extend the deadline. Stopping or expiry ends the mode for the account, while logging out one browser session does not stop other sessions. Already admitted requests and side effects handed to other systems cannot be undone by stopping.

## Explore the delivered clients

For an existing application, start with [Install and configure](setup.md) and follow [Use a support mode](usage.md). Its [Edge form recipe](clients/edge.md) matches the journey above; the [native-session demo](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/736b5d9327b56dd90b1b506b07fa7bad0e7fbb9b/examples/native-session) is runnable and includes the fictional accounts.

For a same-origin browser client, follow the [JSON client guide](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/736b5d9327b56dd90b1b506b07fa7bad0e7fbb9b/docs/guide/clients/json.md) and try it in the same [native-session example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/736b5d9327b56dd90b1b506b07fa7bad0e7fbb9b/examples/native-session) at `/support/json`. For React and Inertia, follow the [React client guide](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/235ce0e44bc74fb088960ba91ea13a9a70cc71e3/docs/guide/clients/react.md) and run its [Inertia example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/235ce0e44bc74fb088960ba91ea13a9a70cc71e3/examples/inertia-react). The [Security and operations guide](security.md) explains authorization, expiry, account-wide
behavior, recovery and side effects.
