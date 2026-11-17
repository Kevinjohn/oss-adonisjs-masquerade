import { useEffect, useState } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import Page from '~/components/page'
import AppLayout from '~/layouts/app'

type Mode =
  | { isMasquerading: false; contextToken: string }
  | {
      isMasquerading: true
      contextToken: string
      targetId: string
      access: 'view' | 'edit'
      expiresAt: string
    }

export default function MasqueradeAccounts({
  operatorEmail,
  canMasquerade,
  mode,
  accounts,
  targetEmail,
  expired: initiallyExpired,
  outcome,
}: {
  operatorEmail: string
  canMasquerade: boolean
  mode: Mode
  accounts: { id: number; email: string }[]
  targetEmail: string | null
  expired: boolean
  outcome: { type: 'success' | 'error'; message: string } | null
}) {
  const [expired, setExpired] = useState(initiallyExpired)
  useEffect(() => {
    if (!mode.isMasquerading) return
    const update = () => setExpired(Date.parse(mode.expiresAt) <= Date.now())
    update()
    const timer = window.setTimeout(update, Math.max(0, Date.parse(mode.expiresAt) - Date.now()))
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [mode])
  return (
    <Page title="Masquerade">
      <p>
        Signed in as <strong>{operatorEmail}</strong>.
      </p>
      {outcome && <p role={outcome.type === 'error' ? 'alert' : 'status'}>{outcome.message}</p>}

      {mode.isMasquerading ? (
        <>
          {expired ? (
            <>
              <p role="status">
                The persisted masquerade mode has expired. Refresh status or stop it.
              </p>
              <p>
                <Link route="masquerade.accounts">Refresh status</Link>
              </p>
            </>
          ) : (
            <>
              <p>
                You are acting as <strong>{targetEmail ?? `account ${mode.targetId}`}</strong> (
                {mode.access === 'edit' ? 'can edit' : 'view only'}) until{' '}
                <time dateTime={mode.expiresAt}>{new Date(mode.expiresAt).toLocaleString()}</time>.
              </p>
              <p>
                <Link route="dashboard">Open their dashboard</Link>
              </p>
            </>
          )}
          <Form route="masquerade.stop">
            <input type="hidden" name="_masqueradeContext" value={mode.contextToken} />
            <button type="submit" className="btn btn--primary">
              Stop masquerade
            </button>
          </Form>
        </>
      ) : !canMasquerade ? (
        <p>Your account is not a masquerade operator.</p>
      ) : accounts.length === 0 ? (
        <p>There are no other accounts yet.</p>
      ) : (
        <ul>
          {accounts.map((account) => (
            <li key={account.id}>
              <Form route="masquerade.start">
                <input type="hidden" name="_masqueradeContext" value={mode.contextToken} />
                <input type="hidden" name="targetId" value={account.id} />
                <span>{account.email}</span>{' '}
                <label>
                  Access{' '}
                  <select name="access" defaultValue="view">
                    <option value="view">View only</option>
                    <option value="edit">Can edit</option>
                  </select>
                </label>{' '}
                <button type="submit" className="btn btn--primary btn--sm">
                  Act as {account.email}
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

MasqueradeAccounts.layout = [AppLayout]
