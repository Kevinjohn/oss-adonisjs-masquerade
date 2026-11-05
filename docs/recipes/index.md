# Recipes

Copy-and-adapt solutions for common Masquerade tasks. Each recipe lists the files it changes and
ends with a test. New to the vocabulary? Read the [terms](../guide/glossary.md) first.

## Start here

**[Add support mode to a new AdonisJS app](starter-kit.md)**: from `pnpm create adonisjs` to a
support page, a banner with Stop, and passing tests. Applied to a fresh Hypermedia starter kit and
tested before publishing.

## Find a recipe by task

| I want to…                                            | Recipe                                                                                             | Main files                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Install and get a working support page                | [Starter kit](starter-kit.md)                                                                      | `config/masquerade.ts`, `start/routes.ts`     |
| Add the account columns Masquerade needs              | [Starter kit, step 2](starter-kit.md#step-2-add-the-account-columns)                               | `database/migrations/*`                       |
| Let only support staff start a mode                   | [Who can support whom](who-can-masquerade.md#a-boolean-operator-flag)                              | `config/masquerade.ts`                        |
| Let everyone view but only leads edit                 | [Who can support whom](who-can-masquerade.md#roles-everyone-views-leads-edit)                      | `config/masquerade.ts`                        |
| Limit operators to their own team or tenant           | [Who can support whom](who-can-masquerade.md#teams-support-only-customers-in-your-team)            | `config/masquerade.ts`                        |
| Require a reason, an open ticket, or a shorter window | [Who can support whom](who-can-masquerade.md#only-with-an-open-ticket-a-reason-and-a-short-window) | `config/masquerade.ts`                        |
| Let support edit some pages but never passwords       | [Mark routes and forms](routes-and-forms.md#pick-a-marker-for-each-route)                          | `start/routes.ts`                             |
| Fix `428 E_MASQUERADE_CONTEXT_REQUIRED` on my forms   | [Mark routes and forms](routes-and-forms.md#add-the-context-token-to-every-form)                   | Edge views, client code                       |
| Add Masquerade to an app with many existing forms     | [Mark routes and forms](routes-and-forms.md#roll-out-in-an-app-that-already-has-forms)             | `config/masquerade.ts`                        |
| Build a page where operators pick a customer          | [Starter kit, step 5](starter-kit.md#step-5-build-the-support-page)                                | `app/controllers/support_controller.ts`       |
| Show a banner with a Stop button                      | [Starter kit, step 6](starter-kit.md#step-6-show-the-banner)                                       | `resources/views/components/layouts/app.edge` |
| End support when a password or role changes           | [End support when an account changes](end-modes-on-account-changes.md)                             | `config/masquerade.ts`                        |
| End a mode from the server                            | [End support when an account changes](end-modes-on-account-changes.md#end-a-mode-from-the-server)  | `node ace masquerade:stop`                    |
| Write tests that run as a masquerading operator       | [Testing your routes](../guide/testing.md)                                                         | `tests/bootstrap.ts`                          |
| Record who really made a change                       | [Audit business work](../guide/audit.md)                                                           | Your audit writer                             |
| Show a history of support sessions                    | [Review masquerade history](../guide/audit.md#review-masquerade-history)                           | A raw-guard controller                        |
| Post to Slack when a mode starts                      | [Alert on masquerade activity](../guide/alerts.md)                                                 | `start/masquerade_alerts.ts`                  |
| Clean up old modes and events                         | [Pruning and active modes](../guide/operations.md)                                                 | Scheduler                                     |
| Support customers over a bearer-token API             | [Opaque access tokens](../guide/access-tokens.md)                                                  | `config/auth.ts`, `config/masquerade.ts`      |
| Use Masquerade from React or Vue (Inertia)            | [React](../guide/clients/react.md), [Vue](../guide/clients/vue.md)                                 | Client pages                                  |
| Call the controls from browser JavaScript             | [Session JSON client](../guide/clients/json.md)                                                    | Client code                                   |
| Use Account Kit accounts                              | [Account Kit integration](../guide/account-kit.md)                                                 | `config/masquerade.ts`                        |
| Understand an error code                              | [Troubleshooting](../guide/troubleshooting.md)                                                     | —                                             |

## Working examples

Each example is a complete AdonisJS 7 app with tests. Its README lists the files to copy.

| Example                                                                                                      | Shows                                                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [native-session](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/native-session)     | Edge forms, a JSON client and a bearer-token API; `pnpm demo` |
| [inertia-react](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/inertia-react)       | React 19 with Inertia, from the official React starter kit    |
| [inertia-vue](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/inertia-vue)           | Vue 3 with Inertia, from the official Vue starter kit         |
| [account-kit-demo](https://github.com/Kevinjohn/oss-adonisjs-masquerade/tree/main/examples/account-kit-demo) | Masquerade with Account Kit-managed accounts                  |
