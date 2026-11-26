/**
 * Router middleware entry, registered after `initialize_auth` and before `silent_auth`:
 * `() => import('@kevinjohn/adonisjs-masquerade/masquerade_context_middleware')`.
 */
export { default } from '../http/context_middleware.ts'
