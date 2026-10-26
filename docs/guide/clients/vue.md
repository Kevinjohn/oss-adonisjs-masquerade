# Inertia Vue integration

The [runnable Vue example](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/inertia-vue) is an AdonisJS 7 application built on the official [Inertia Vue starter](https://github.com/adonisjs/starter-kits/tree/46d235932e3eb6472a16b740fa0b47b5f69fc6fc/inertia-vue). It uses the locally built package tarball, native session authentication, Lucid SQLite, and disables SSR. See its [README](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/inertia-vue/README.md) for clean-checkout commands and local demo credentials.

For a fresh host application, use the official [AdonisJS installation guide](https://docs.adonisjs.com/installation) with its Vue starter and follow the current [Inertia guide](https://docs.adonisjs.com/guides/frontend/inertia) for the app entry point, shared page props, form helpers, redirects, and history options. Install a locally built package artifact while the package is in alpha. From the package checkout, run `pnpm build` and `pnpm pack --out tmp/inertia-vue-package.tgz`; in the host app, install that tarball with pnpm. A validated tagged baseline can be selected by the exact tag recorded in issue #66 and packed the same way.

## Keep one native session guard

The official Vue starter does not include AdonisJS Bouncer or the rate limiter used by the runnable example's authorization checks and support controls. If you copy its `DemoController` and route setup, install the packages with `pnpm add @adonisjs/bouncer @adonisjs/limiter`, register `() => import('@adonisjs/limiter/limiter_provider')` in `adonisrc.ts`, and add a host `config/limiter.ts` with an appropriate store. See the official [rate-limiting guide](https://docs.adonisjs.com/guides/security/rate-limiting) for store setup. Bouncer is instantiated directly by the example, so no Bouncer request middleware is needed for that pattern; applications using `ctx.bouncer` should follow the official [authorization setup](https://docs.adonisjs.com/guides/auth/authorization). You can use another host authorization and rate-limiting implementation, but keep the same account checks and protect start and stop controls from abuse.

The application owns its session guard and user provider. Create the raw guard once, use that same guard factory for the ordinary and effective guards, and give the effective guard a distinct name:

```ts
// app/services/web_guard.ts
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'

export const userProvider = sessionUserProvider({ model: () => import('#models/user') })
export const webGuard = sessionGuard({
  useRememberMeTokens: false,
  provider: userProvider,
})
```

```ts
// config/auth.ts
import { defineConfig } from '@adonisjs/auth'
import { effectiveSessionGuard } from 'adonisjs-masquerade/auth'
import { webGuard } from '#services/web_guard'

export default defineConfig({
  default: 'web_effective',
  guards: {
    web: webGuard,
    web_effective: effectiveSessionGuard(webGuard),
  },
})
```

Keep the normal application auth provider, models, migrations, login, and logout. Keep the effective guard as the default for business surfaces, and make silent authentication explicitly check the raw `web` guard so public and support-control routes remain tied to the operator session. Choose `web` explicitly on support controls and `web_effective` on customer business routes.

If the host uses `withAuthFinder` in its Lucid user model, pass a lazy hash resolver such as `withAuthFinder(() => hash.use())`. This defers service lookup until the provider has booted, including when Ace commands import the model before application startup.

## Configure host-owned account policy

Use `sessionAuthority` with a stable namespace for the host's account-wide scope, the raw guard name, and the same user provider. Declare an immutable ID or an explicit incarnation callback. Read a host-owned security stamp that the application advances when credentials, suspension, or privilege state changes. Keep the active-account check and operator-to-customer policy in host callbacks:

```ts
const native = sessionAuthority({
  namespace: 'support-console',
  guard: 'web',
  provider: userProvider,
  incarnation: 'id', // only if IDs are never reused
  securityStamp: (user: User) => user.securityStamp,
  isActive: (user: User) => Boolean(user.active),
})

export default defineConfig({
  authority: native.authority,
  policy: {
    canMasquerade: ({ actor, target }) =>
      Boolean(actor.user.isSupportOperator) && Boolean(target.user.active),
    canEdit: ({ actor, target }) =>
      Boolean(actor.user.isSupportOperator) && Boolean(target.user.active),
    canUseRequest: ({ actor, target }) => Boolean(actor.user.active) && Boolean(target.user.active),
  },
  store: async () => new LucidControlStore((await app.container.make(Database)).connection()),
})
```

Register the app's native adapter provider and the package provider. Add the package's Lucid schema in a host migration. Keep customer eligibility in the host's policy and model callbacks; never issue a customer credential or broaden operator permissions.

## Split raw controls from effective work

Register `masqueradeContext` after body parsing, session, Shield, and auth initialization. The package's native routes and host support controls use the raw `web` guard. Customer reads and reversible mutations use `web_effective`. A mode starts with `access: 'view'`; a start form may request edit, which the host's `canEdit` policy must approve. `allowMutation()` opts a route into ordinary mutation only in edit mode, and `sensitive()` always blocks:

```ts
router
  .group(() => {
    router.get('/support', [DemoController, 'workspace'])
    router.post('/support/start', [DemoController, 'start'])
    router.post('/support/stop', [DemoController, 'stop'])
  })
  .use(middleware.auth({ guards: ['web'] }))

router
  .get('/support/customer', [DemoController, 'customer'])
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/customer/preference', [DemoController, 'preference'])
  .use(allowMutation())
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/customer/close-account', [DemoController, 'closeAccount'])
  .use(sensitive())
  .use(middleware.auth({ guards: ['web_effective'] }))
```

On an effective request, call `runtime.admit(ctx)` before reading customer data or authorizing the business action. Use the admitted context and the effective `ctx.auth.user`. On the raw workspace, `runtime.service.status(ctx)` observes stored state and returns the context token; it does not prove that the customer is still eligible or the fixed deadline is in the future. Keep raw stop available if admission fails. The example routes are in [`start/demo_routes.ts`](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/inertia-vue/start/demo_routes.ts), and the corresponding selected-props controllers are in [`demo_controller.ts`](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/inertia-vue/app/controllers/demo_controller.ts).

Return only the selected actor and customer labels, allowed action flags, deadline, and context token in request-scoped Inertia props. Do not pass complete models, password hashes, security stamps, or audit reasons. Send `Cache-Control: private, no-store` and vary on `Accept` and `X-Masquerade-Context` for identity-bound responses.

With configure's optional `--banner`, the host middleware shares the same `ModeView` under the
`masquerade` prop on authenticated effective-guard routes. A banner can use only this projection;
the package does not look up user display fields. Use a host-owned redirecting stop route for an
Inertia form (`/support/stop` below). The package's `/masquerade/stop` route returns JSON for
non-Inertia clients.

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import { usePage } from '@inertiajs/vue3'
import type { ModeView } from 'adonisjs-masquerade/types'

type SharedProps = { masquerade?: ModeView }
const page = usePage<SharedProps>()
const masquerade = computed(() => page.props.masquerade)
</script>

<template>
  <aside
    v-if="masquerade?.isMasquerading"
    class="masquerade-banner"
    role="status"
    aria-live="polite"
  >
    <p>You are viewing as account {{ masquerade.targetId }}.</p>
    <p>Access: {{ masquerade.access === 'edit' ? 'Can edit' : 'View only' }}.</p>
    <p>Fixed deadline: <time :datetime="masquerade.expiresAt">{{ masquerade.expiresAt }}</time></p>
    <Form route="demo.stop" method="post">
      <input type="hidden" name="_masqueradeContext" :value="masquerade.contextToken" />
      <button type="submit">Stop masquerade</button>
    </Form>
  </aside>
</template>
```

## Bind each form to its original intent

Every covered unsafe form requires the current context token while idle and during support mode. Capture it when constructing the form and keep it with the payload the user saw:

```vue
<script setup lang="ts">
const props = defineProps<{ context: string }>()
const originalContext = props.context
</script>

<template>
  <Form route="support.start">
    <input type="hidden" name="_masqueradeContext" :value="originalContext" />
    <!-- customer and reason inputs -->
    <label for="access">Access</label>
    <select id="access" name="access" defaultValue="view">
      <option value="view" selected>View only</option>
      <option value="edit">Can edit</option>
    </select>
    <button type="submit">Start support mode</button>
  </Form>
</template>
```

Shield's CSRF token is separate. A start request may send `access: 'view' | 'edit'`; omission defaults to view. Active `ModeView` props include `access`, which stays fixed until stop. For `E_MASQUERADE_ACTION_BLOCKED`, the error item also contains `blockedBy: 'sensitive' | 'view_only' | 'mutation_not_allowed'`; the host chooses its own message and recovery page. Do not replace an old form's context token after a props refresh. A 409 or 428 rejects the old intent; render a recovery page and ask the operator to inspect current status and deliberately create a new action. A 503 may leave the result of a transition unknown; inspect raw status without replaying the transition.

## Refresh and protect restored pages

Carry a history-clear signal through successful start, stop, and logout redirects. Call `ctx.inertia.clearHistory()` while rendering the destination page, and enable `ctx.inertia.encryptHistory()` for pages containing customer data. The [Vue app](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/examples/inertia-vue/inertia/app.ts) also redirects Back/Forward and browser-cache restores to the raw workspace after customer data has been visited. Do not use once, merged, or preserved props, or local-storage drafts, for identity-bound data.

Hide restored customer props until a no-store raw status request confirms the same target and context. Repeat the check when the document becomes visible and freeze customer actions at the fixed deadline. Apply the same raw status check to the operator workspace when it mounts, becomes visible or is restored, and reload it when the target or context has changed or the deadline passes. Cancel or ignore stale client responses by page generation and abort signal, while treating server admission as authoritative: cancellation does not undo a request already admitted.

The host's recovery page should move keyboard focus to its heading, explain that the prior form was not replayed, and offer a deliberate link back to raw status. Browser tests should cover the full transition journey, stale tabs, account-wide changes from a second operator session, Back/Forward, delayed responses, expiry, sensitive denial, focus, labels, keyboard operation, and narrow-screen overflow. The example's automated coverage is Chromium-only and does not establish screen-reader support or behavior in every browser and assistive-technology combination.
