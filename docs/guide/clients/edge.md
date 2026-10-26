# Edge forms and host redirects

The package controller keeps its JSON response for JSON clients. To scaffold a host-owned
controller that also accepts Edge form posts, opt in when configuring the package:

```sh
node ace configure adonisjs-masquerade --form-controller
```

Configure creates `app/controllers/masquerade_form_controller.ts` and, when it can wire the
starter-kit routes, uses that controller for POST start/stop while the package controller serves
JSON status. Only requests that explicitly accept HTML and negotiate it use the form adapter; JSON
requests, requests without an `Accept` header, and wildcard-only requests delegate to the package
controller. HTML requests call the same service, redirect, and flash a typed result
under the `masquerade` key. Success values identify `started` or `stopped`; errors carry the stable
`MasqueradeErrorCode`, which the host can map to localized text in its Edge layout. Edit the success
redirect methods `redirectAfterStart` and `redirectAfterStop` for the destination pages and
`errorPath` for the form recovery page. HTML forms require the host's session middleware for flash
storage. The controller renders no UI.

Use `--banner --form-controller` together when generating the starter banner: its
`route('masquerade.stop')` action then reaches the host-owned HTML adapter. Without
`--form-controller`, the package route keeps its JSON response, including for a browser form.
With `--no-wire`, configure prints the manual route wiring instead.

The native-session example extends the generated controller and overrides only its app-specific
redirects. For a host-rendered status page, call `runtime.service.status(ctx)`, load eligible target
choices with the host's account query, and render the result. Keep that page behind the raw `web`
guard so recovery remains available when the effective account or operator eligibility changes.
Attach separate start and stop limiters to the host form routes:

<!-- host-recipe:html-control-routes -->

```ts
import { middleware } from '#start/kernel'
import { startMasqueradeLimiter, stopMasqueradeLimiter } from '#start/masquerade_control_limiter'
import router from '@adonisjs/core/services/router'

router
  .group(() => {
    router.get('/', [() => import('#controllers/demo_controller'), 'status']).as('demo.workspace')
    router
      .post('/start', [() => import('#controllers/demo_controller'), 'start'])
      .as('demo.start')
      .use(startMasqueradeLimiter)
    router
      .post('/stop', [() => import('#controllers/demo_controller'), 'stop'])
      .as('demo.stop')
      .use(stopMasqueradeLimiter)
  })
  .prefix('/support')
  .use(middleware.auth({ guards: ['web'] }))
```

Keep the raw actor guard, separate limiter, Shield CSRF, and captured context token on the Edge
POSTs too. Configure's generated form controller enforces the 8 KiB body limit, accepts only
URL-encoded control fields, and leaves malformed input on the service's normal audit path. It
flashes typed errors by stable code and leaves localization to the host. For an Inertia adapter,
retain the same input and service boundaries, and clear Inertia history after transitions as
described in the official [AdonisJS Inertia guide](https://docs.adonisjs.com/guides/frontend/inertia).

The input parser is part of the generated `app/controllers/masquerade_form_controller.ts`; edit
that host-owned file when adding fields. It validates URL-encoded input and the captured
`_masqueradeContext` before calling the service.

The generated parser accepts an optional duration field and converts only canonical, safe integer
strings; core validation enforces the configured duration bounds. HTML control responses set
`Cache-Control: private, no-store` and `Vary: Accept, X-Masquerade-Context`.
The example's `DemoController` extends `MasqueradeFormController` and overrides only the
host-specific redirects. Its other methods own the eligible-account query, customer workspace, and
business form. The generated controller supplies start/stop input parsing, service calls, and typed
flashes.
The status action renders a start form only when the host query returned eligible customers. The
form component supplies Shield CSRF, and the hidden field keeps the context token from that status
response with this start intent. This excerpt is copied from the
[demo workspace Edge template](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/native-session/resources/views/pages/demo_workspace.edge):

<!-- host-recipe:start-form -->

```edge
@if(customers.length)
  @form({ route: 'demo.start', method: 'POST', class: 'support-form' })
    <input type="hidden" name="_masqueradeContext" value="{{ mode.contextToken }}" />
    <div class="field">
      <label class="field__label" for="targetId">Customer</label>
      <select
        class="field__input"
        id="targetId"
        name="targetId"
        required
        aria-describedby="customer-hint"
      >
        <option value="">Select a customer</option>
        @each(customer in customers)
          <option value="{{ customer.id }}">
            {{ customer.fullName || customer.email }}
            —
            {{ customer.email }}
          </option>
        @end
      </select>
      <p class="field__hint" id="customer-hint">
        Only active seeded customer accounts appear here.
      </p>
    </div>
    <div class="field">
      <label class="field__label" for="reason">Reason for access</label>
      <textarea
        class="field__input support-reason"
        id="reason"
        name="reason"
        required
        minlength="1"
        maxlength="500"
        aria-describedby="reason-hint"
      ></textarea>
      <p class="field__hint" id="reason-hint">
        Required for the audit record. Up to 500 characters; do not enter secrets.
      </p>
    </div>
    <fieldset class="field">
      <legend class="field__label">Access level</legend>
      <label class="field__choice">
        <input type="radio" name="access" value="view" checked />

        View only

      </label>
      <label class="field__choice">
        <input type="radio" name="access" value="edit" />

        Can edit

      </label>
    </fieldset>
    <button class="btn btn--primary" type="submit">Start support mode</button>
  @end
@else
  <p role="status" class="support-copy">
    No eligible seeded customers are available. Run the local demo seed command, then refresh this page.
  </p>
@end
```

For the effective business route, edit access and `allowMutation()` are both required; the
controller's Bouncer ability still checks the effective customer's ordinary permission before the
write. The `@form` component adds Shield's CSRF field, and the hidden field supplies the context
token captured with this page. This is the form in the
[customer workspace Edge template](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/native-session/resources/views/pages/demo_customer.edge):

<!-- host-recipe:business-preference-form -->

```edge
@if(canEdit)
  @form({
    route: 'demo.preference',
    method: 'POST',
    class: 'support-form',
    'data-support-intent': true,
  })
    <input type="hidden" name="_masqueradeContext" value="{{ mode.contextToken }}" />
    <div class="field">
      <label class="field__label" for="emailUpdates">Setting</label>
      <select class="field__input" id="emailUpdates" name="emailUpdates" required>
        <option value="1" {{ emailUpdates ? 'selected' : '' }}>On</option>
        <option value="0" {{ !emailUpdates ? 'selected' : '' }}>Off</option>
      </select>
    </div>
    <button class="btn btn--primary" type="submit">Save preference</button>
  @end
@else
  <p role="status" class="support-copy">This customer cannot change the preference.</p>
@end
```

The form submits the original token with the user's choice. A stale-context response requires a
refresh and deliberate rebuild; the host must not replace the token and automatically resend the
old selection.

Use the active view's latest token on its stop form too. The demo renders the stop control on both
the raw status page and the customer workspace; the forms are in the same
[workspace templates](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/native-session/resources/views/pages):

<!-- host-recipe:stop-form -->

```edge
@form({ route: 'demo.stop', method: 'POST' })
  <input type="hidden" name="_masqueradeContext" value="{{ mode.contextToken }}" />
  <button class="btn btn--primary" type="submit">Stop support mode</button>
@end
```
