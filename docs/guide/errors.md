# Recover from errors

The default JSON error item carries `code` and `message`, plus `blockedBy` exactly for
`E_MASQUERADE_ACTION_BLOCKED`. Messages use `errors.<code>` through the request's `ctx.i18n` when
the application has an i18n instance, with the English text as fallback. Without one, the response
uses the English text. Masquerade ships no translations, loader or locale setting. For HTML, render
a message and recovery link rather than retrying behind the operator's back.

Missing native authentication raises the host's `E_UNAUTHORIZED_ACCESS` exception. The host
controls its response: ordinary JSON may contain only a message, JSON:API may include a code, and
session HTML requests may redirect to sign-in. Use the host's authentication and translation
configuration for that case; do not match a Masquerade authentication code in the response.

Add these English entries to the host application's `errors.json` locale file if it uses
`@adonisjs/i18n`:

```json
{
  "E_MASQUERADE_NOT_ALLOWED": "Masquerade is not allowed",
  "E_MASQUERADE_ACTION_BLOCKED": "Action is blocked while masquerading",
  "E_MASQUERADE_ALREADY_ACTIVE": "Masquerade is already active",
  "E_MASQUERADE_CONTEXT_CHANGED": "Masquerade context changed",
  "E_MASQUERADE_INVALID_INPUT": "Invalid masquerade input",
  "E_MASQUERADE_CONTEXT_REQUIRED": "Masquerade context required",
  "E_MASQUERADE_UNAVAILABLE": "Masquerade is unavailable"
}
```

| Situation                                                           | Response                            | Recovery                                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Missing control or business context                                 | `428 E_MASQUERADE_CONTEXT_REQUIRED` | Read status and rebuild the action using its current token.                                                     |
| Stale token, expired mode, or another tab/device changed the mode   | `409 E_MASQUERADE_CONTEXT_CHANGED`  | Refresh status; require deliberate resubmission of rebuilt input. Never refresh a token and replay old intent.  |
| Start submitted while a mode is active                              | `409 E_MASQUERADE_ALREADY_ACTIVE`   | Read current status and stop before starting another mode.                                                      |
| View-mode mutation, unmarked edit mutation, or sensitive route      | `403 E_MASQUERADE_ACTION_BLOCKED`   | Use `blockedBy` to explain the denial. Edit and a mutation marker do not grant customer permission.             |
| Store or service unavailable                                        | `503 E_MASQUERADE_UNAVAILABLE`      | After an uncertain control response, GET status before deciding what to do. Do not blindly retry the old start. |
| Invalid fields, duration, or reason                                 | `422 E_MASQUERADE_INVALID_INPUT`    | Show the validation problem and ask the operator to submit corrected data with the current token.               |
| Start denied by eligibility or policy, or a token lacks the ability | `403 E_MASQUERADE_NOT_ALLOWED`      | Show a generic denial; it does not say whether the target exists. See [troubleshooting](troubleshooting.md).    |

`E_MASQUERADE_UNAUTHENTICATED` is declared for compatibility and never emitted; native Auth answers
unauthenticated requests. Setup failures raise `E_MASQUERADE_INVALID_CONFIGURATION` or
`E_MASQUERADE_INVALID_STORE` at boot or from Ace commands, not in HTTP responses.

The host can branch on `blockedBy` before its normal exception handling. This helper shows
three presentation paths: JSON passes to the standard handler, HTML renders a host page, and
a host workflow can choose a flash-and-redirect response. Supply your own `errors/blocked_action`
Edge template (or use `ctx.inertia.render` for a host Inertia page). The template receives only
the host's explanation and should offer a link to status or stop.

```ts
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade'
import type { HttpContext } from '@adonisjs/core/http'

export async function handleBlockedAction(
  error: unknown,
  ctx: HttpContext,
  presentation: 'page' | 'redirect' = 'page'
): Promise<boolean> {
  if (!(error instanceof MasqueradeError) || error.code !== 'E_MASQUERADE_ACTION_BLOCKED')
    return false
  if (ctx.request.accepts(['html', 'json']) !== 'html') return false
  const explanations = {
    sensitive: 'This action is unavailable during support mode. Stop and use your own account.',
    view_only: 'This session is view only. Stop and choose Can edit if your role permits it.',
    mutation_not_allowed:
      'This action is unavailable during support mode. Return to the customer page.',
  }
  const explanation = explanations[error.blockedBy ?? 'sensitive']
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
its wording, flash rendering, redirect destination and templates; no package translation catalog is used.

The native-session browser fixture keeps status and stop on the raw actor guard so an operator can
inspect or end a recorded mode if the target, actor eligibility, or start permission changes. A
control denial is not evidence that an earlier request did not commit: after a lost or uncertain
response, status is the source of current state.
