import { Link } from '@inertiajs/react'
import ContextForm from './context_form'
import SupportBanner from '~/components/support_banner'
import { useIdentityFreshness } from './use_identity_freshness'

type Label = { id: number; fullName: string | null; email: string }
type Mode =
  | { isMasquerading: false; contextToken: string }
  | {
      isMasquerading: true
      contextToken: string
      targetId: string
      expiresAt: string
      access: 'view' | 'edit'
    }

export default function Workspace({
  actor,
  operator,
  mode,
  customers,
  target,
  beforeDeadline,
  targetAvailable,
}: {
  actor: Label
  operator: boolean
  mode: Mode
  customers: Label[]
  target: Label | null
  beforeDeadline: boolean
  targetAvailable: boolean
}) {
  const stale = useIdentityFreshness(
    mode.isMasquerading && beforeDeadline ? mode.expiresAt : undefined,
    mode.isMasquerading
  )
  if (stale)
    return (
      <p role="status" aria-live="assertive">
        Refreshing support status…
      </p>
    )
  return (
    <section className="support-page">
      <h1>Support workspace</h1>
      <p>
        Signed-in operator: <strong>{actor.fullName ?? actor.email}</strong>. Support mode applies
        across this operator account, including other sessions.
      </p>
      {mode.isMasquerading ? (
        <>
          {target && (
            <SupportBanner
              actor={actor}
              customer={target}
              expiresAt={mode.expiresAt}
              access={mode.access}
            />
          )}
          {!targetAvailable && (
            <p role="alert">
              This customer is unavailable. Stop support mode from this operator workspace.
            </p>
          )}
          {!beforeDeadline && (
            <p role="alert">
              The fixed deadline has passed. Check status before taking another action.
            </p>
          )}
          {targetAvailable && beforeDeadline && (
            <p>
              <Link href="/support/customer">Open customer view</Link>
            </p>
          )}
          <ContextForm action="/support/stop" context={mode.contextToken}>
            <button type="submit">Stop support mode</button>
          </ContextForm>
        </>
      ) : operator ? (
        <ContextForm action="/support/start" context={mode.contextToken}>
          <label htmlFor="targetId">Customer</label>
          <select id="targetId" name="targetId" required defaultValue="">
            <option value="" disabled>
              Choose a customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.fullName ?? customer.email}
              </option>
            ))}
          </select>
          <label htmlFor="reason">Reason for support</label>
          <textarea id="reason" name="reason" minLength={1} maxLength={500} required />
          <fieldset>
            <legend>Access level</legend>
            <label>
              <input type="radio" name="access" value="view" defaultChecked />
              View only
            </label>
            <label>
              <input type="radio" name="access" value="edit" />
              Can edit
            </label>
          </fieldset>
          <button type="submit">Start support mode</button>
        </ContextForm>
      ) : (
        <p>This account cannot start support mode.</p>
      )}
    </section>
  )
}
