# Inertia React integration

The [runnable React example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/inertia-react) uses the official AdonisJS 7 React starter, native session authentication and the built package tarball. Its [routes](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/inertia-react/start/demo_routes.ts) show the guard split: operator controls stay on the raw `web` guard, while customer reads and marked mutations use `web_effective`.

On an effective customer page, call the public `masquerade.runtime` binding's `admit(ctx)` and send only selected operator and customer labels, allowed actions, fixed deadline and admitted context token to Inertia. On the raw workspace, `runtime.service.status(ctx)` observes stored mode state; it does not prove that the target is still eligible or the deadline unexpired. Keep stop reachable from that workspace when admission fails. Do not serialize complete models, security stamps, passwords or audit reasons. Bouncer checks for business actions must use the effective customer.

Use a hidden `_masqueradeContext` field on every unsafe form, including idle forms. Capture it when the form is constructed and keep it with the user's original payload. Shield's XSRF cookie is separate from this context token. A props refresh cannot repair an old intent: after a 409 or 428, send the user to a recovery page and require a deliberate new action. Likewise, a 503 after start or stop can mean the outcome is unknown; inspect raw status without replaying the request. The package's canonical JSON controls remain available at `/masquerade`.

Inertia retains page objects in browser history. Enable history encryption and carry a history-clear signal across successful start, stop and logout redirects; call `inertia.clearHistory()` on the rendered destination page. A call on a redirect response alone does not clear the browser key. Avoid `once`, merged, preserved props and local-storage drafts for identity-bound data. Revalidate a restored or newly visible page before showing customer data; freeze actions at the fixed deadline. The example sends Back, Forward and browser-cache restorations to the raw workspace after a tab has visited a support page, even from public pages after logout. Frontend cancellation may discard a late response, but it does not reverse a server request already admitted. The server's context check remains the authority when another tab or operator session changes mode.

With configure's optional `--banner`, the host middleware shares the same `ModeView` under the
`masquerade` prop on authenticated effective-guard routes. A banner can use only this projection;
the package does not look up user display fields. Use a host-owned redirecting stop route for an
Inertia form (`/support/stop` below). The package's `/masquerade/stop` route returns JSON for
non-Inertia clients.

```tsx
import { Form, usePage } from '@inertiajs/react'
import type { ModeView } from 'adonisjs-masquerade/types'

type SharedProps = { masquerade?: ModeView }

export function MasqueradeBanner() {
  const { masquerade } = usePage<SharedProps>().props
  if (!masquerade?.isMasquerading) return null

  return (
    <aside className="masquerade-banner" role="status" aria-live="polite">
      <p>You are viewing as account {masquerade.targetId}.</p>
      <p>Access: {masquerade.access === 'edit' ? 'Can edit' : 'View only'}.</p>
      <p>
        Fixed deadline: <time dateTime={masquerade.expiresAt}>{masquerade.expiresAt}</time>
      </p>
      <Form action="/support/stop" method="post">
        <input
          type="hidden"
          name="_masqueradeContext"
          value={masquerade.contextToken}
          readOnly
        />
        <button type="submit">Stop masquerade</button>
      </Form>
    </aside>
  )
}
```

## Access level and blocked actions

A start request may include `access: 'view' | 'edit'`; omitting it starts in view mode. The active
`ModeView` exposes the selected `access`, and the level stays fixed until the operator stops the
mode. Edit starts require the host's `canEdit` callback to return exactly `true`; active edit
admission checks it again. A route's `allowMutation()` marker alone does not grant edit, and a bearer
ability does not grant edit or target authorization.

`E_MASQUERADE_ACTION_BLOCKED` includes `blockedBy` in its error item:

```ts
type MasqueradeBlockedBy = 'sensitive' | 'view_only' | 'mutation_not_allowed'
```

Use that stable field to choose host-owned copy and recovery. Keep the explanation in the host
application's language; the package supplies no page or translation strings.

The example's [functional tests](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/inertia-react/tests/functional/support_journey.spec.ts) cover raw and effective identities, persistence, sensitive denial, stale forms and recovery. Its [browser tests](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/inertia-react/tests/browser/support_journey.spec.ts) exercise rendered forms and accessibility checks. Automated browser coverage is Chromium only and cannot establish screen-reader support or every narrow-screen device combination.
