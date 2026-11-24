# Recover from errors

The default JSON error item carries `code` and `message`, plus `blockedBy` for
a blocked action. Messages use `errors.<code>` through the request's `ctx.i18n` when
the application has an i18n instance, with the English text as fallback. Without one, the response
uses the English text. Masquerade ships no translations, loader or locale setting. For HTML, render
a message and recovery link rather than retrying behind the operator's back.

Missing native authentication raises the host's `E_UNAUTHORIZED_ACCESS` exception. The host
controls its response: ordinary JSON may contain only a message, JSON:API may include a code, and
session HTML requests may redirect to sign-in. Use the host's authentication and translation
configuration for that case; do not match a Masquerade authentication code in the response.

Add entries like these to the host application's `errors.json` locale file if it uses
`@adonisjs/i18n`:

```json
{
  "E_MASQUERADE_NOT_ALLOWED": "Masquerade is not allowed",
  "E_MASQUERADE_SENSITIVE_ACTION_BLOCKED": "Action is blocked while masquerading",
  "E_MASQUERADE_VIEW_ONLY_ACTION_BLOCKED": "Action is blocked while masquerading",
  "E_MASQUERADE_UNMARKED_MUTATION_BLOCKED": "Action is blocked while masquerading",
  "E_MASQUERADE_ALREADY_ACTIVE": "Masquerade is already active",
  "E_MASQUERADE_CONTEXT_CHANGED": "Masquerade context changed",
  "E_MASQUERADE_MODE_EXPIRED": "The active masquerade mode expired",
  "E_MASQUERADE_MODE_INVALIDATED": "The active masquerade mode was invalidated",
  "E_MASQUERADE_TRANSITION_CONFLICT": "The mode changed before the transition could be applied",
  "E_MASQUERADE_UNKNOWN_COMMIT": "The masquerade transition could not be confirmed",
  "E_MASQUERADE_TOKEN_ABILITY_REQUIRED": "The token lacks the ability required to control masquerade",
  "E_MASQUERADE_INVALID_INPUT": "Invalid masquerade input",
  "E_MASQUERADE_CONTEXT_REQUIRED": "Masquerade context required",
  "E_MASQUERADE_UNAVAILABLE": "Masquerade is unavailable"
}
```

| Situation                                                            | Response                                                                                                                          | Recovery                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Missing control or business context                                  | `428 E_MASQUERADE_CONTEXT_REQUIRED`                                                                                               | Read status and rebuild the action using its current token.                                         |
| Stale or conflicting context tokens                                  | `409 E_MASQUERADE_CONTEXT_CHANGED`                                                                                                | Refresh status and rebuild the action.                                                              |
| Mode expired, invalidated, or changed during a concurrent transition | `409 E_MASQUERADE_MODE_EXPIRED`, `E_MASQUERADE_MODE_INVALIDATED`, or `E_MASQUERADE_TRANSITION_CONFLICT`                           | Refresh status and ask the operator to deliberately rebuild the action.                             |
| Start submitted while a mode is active                               | `409 E_MASQUERADE_ALREADY_ACTIVE`                                                                                                 | Read current status and stop before starting another mode.                                          |
| View-mode mutation, unmarked edit mutation, or sensitive route       | `403 E_MASQUERADE_SENSITIVE_ACTION_BLOCKED`, `E_MASQUERADE_VIEW_ONLY_ACTION_BLOCKED`, or `E_MASQUERADE_UNMARKED_MUTATION_BLOCKED` | Use `blockedBy` to explain the denial. Edit and a mutation marker do not grant customer permission. |
| A transition could not be confirmed                                  | `503 E_MASQUERADE_UNKNOWN_COMMIT`                                                                                                 | Read GET status before deciding what to do.                                                         |
| Guard, adapter or middleware wiring failed                           | `503 E_MASQUERADE_UNAVAILABLE`                                                                                                    | Use the server exception or diagnostics to identify the wiring fault.                               |
| An operational failure occurred                                      | A cause-specific 503 such as `E_MASQUERADE_STORE_READ_FAILED` or `E_MASQUERADE_START_POLICY_FAILED`                               | Check the failing integration, then read status before rebuilding the action.                       |
| Invalid fields, duration, or reason                                  | `422 E_MASQUERADE_INVALID_INPUT`                                                                                                  | Show the validation problem and ask the operator to submit corrected data with the current token.   |
| Actor selected their own account                                     | `422 E_MASQUERADE_SELF_TARGET`                                                                                                    | Select another account.                                                                             |
| Eligibility or host policy denied access                             | `403 E_MASQUERADE_NOT_ALLOWED`                                                                                                    | Show a generic denial to protect account eligibility.                                               |
| Token lacks the control ability                                      | `403 E_MASQUERADE_TOKEN_ABILITY_REQUIRED`                                                                                         | Check the token's abilities.                                                                        |

`E_MASQUERADE_UNAUTHENTICATED` is declared for compatibility and never emitted; native Auth answers
unauthenticated requests. Setup failures raise `E_MASQUERADE_INVALID_CONFIGURATION` or
`E_MASQUERADE_STORE_MISSING`, `E_MASQUERADE_TEST_STORE_FORBIDDEN`, or `E_MASQUERADE_STORE_METHOD_MISSING`
at boot or from Ace commands.

In server code, match the specific exception with `instanceof errors.E_MASQUERADE_…` using the
package root's `errors` namespace. Each blocked-action constructor fixes the route cause. For example,
`new errors.E_MASQUERADE_SENSITIVE_ACTION_BLOCKED()` has `blockedBy: 'sensitive'`. Setup exceptions expose the
relevant configuration field. Use `isMasqueradeRequestError(error)` from
`@kevinjohn/adonisjs-masquerade/http` if a custom response needs to recognise any package request
exception. Read its `.code` for server diagnostics and `.responseCode` when rendering or
flashing an error to a client. Wiring exceptions share a response to protect configuration
details. Eligibility and policy denials share a response to protect account existence and
eligibility.

The host can branch on `blockedBy` before its normal exception handling. This helper shows
three presentation paths: JSON passes to the standard handler, HTML renders a host page, and
a host workflow can choose a flash-and-redirect response. Supply your own `errors/blocked_action`
Edge template (or use `ctx.inertia.render` for a host Inertia page). The template receives only
the host's explanation and should offer a link to status or stop.

```ts
import { errors } from '@kevinjohn/adonisjs-masquerade'
import type { HttpContext } from '@adonisjs/core/http'

export async function handleBlockedAction(
  error: unknown,
  ctx: HttpContext,
  presentation: 'page' | 'redirect' = 'page'
): Promise<boolean> {
  if (!(
    error instanceof errors.E_MASQUERADE_SENSITIVE_ACTION_BLOCKED ||
    error instanceof errors.E_MASQUERADE_VIEW_ONLY_ACTION_BLOCKED ||
    error instanceof errors.E_MASQUERADE_UNMARKED_MUTATION_BLOCKED
  ))
    return false
  if (ctx.request.accepts(['html', 'json']) !== 'html') return false
  const explanations = {
    sensitive: 'This action is unavailable during support mode. Stop and use your own account.',
    view_only: 'This session is view only. Stop and choose Can edit if your role permits it.',
    mutation_not_allowed:
      'This action is unavailable during support mode. Return to the customer page.',
  }
  const explanation = explanations[error.blockedBy]
  if (presentation === 'redirect') {
    ctx.session.flash('error', explanation)
    ctx.response.redirect().back()
  } else {
    ctx.response.status(403).send(await ctx.view.render('errors/blocked_action', { explanation }))
  }
  return true
}
```

In the application's error handler, call `if (await handleBlockedAction(error, ctx)) return` before
`super.handle(error, ctx)`. The default path preserves the package JSON response. The host owns
its wording, flash rendering, redirect destination and templates; no package translation catalogue is used.

The native-session browser fixture keeps status and stop on the raw actor guard so an operator can
inspect or end a recorded mode if the target, actor eligibility, or start permission changes. A
control denial is not evidence that an earlier request did not commit: after a lost or uncertain
response, status is the source of current state.
