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
  outcome,
}: {
  operatorEmail: string
  canMasquerade: boolean
  mode: Mode
  accounts: { id: number; email: string }[]
  targetEmail: string | null
  outcome: { type: 'success' | 'error'; message: string } | null
}) {
  return (
    <Page title="Masquerade">
      <p>
        Signed in as <strong>{operatorEmail}</strong>.
      </p>
      {outcome && <p role={outcome.type === 'error' ? 'alert' : 'status'}>{outcome.message}</p>}

      {mode.isMasquerading ? (
        <>
          <p>
            You are acting as <strong>{targetEmail ?? `account ${mode.targetId}`}</strong> (
            {mode.access === 'edit' ? 'can edit' : 'view only'}) until{' '}
            <time dateTime={mode.expiresAt}>{new Date(mode.expiresAt).toLocaleString()}</time>.
          </p>
          <p>
            <Link route="dashboard">Open their dashboard</Link>
          </p>
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
