import { Form } from '@adonisjs/inertia/react'
import { usePage } from '@inertiajs/react'

type MasqueradeStatus =
  | { isMasquerading: false; contextToken: string }
  | {
      isMasquerading: true
      contextToken: string
      targetId: string
      access: 'view' | 'edit'
      expiresAt: string
    }

/**
 * Shown on every page while the signed-in operator acts as another account. The status comes
 * from `ShareMasqueradeStatusMiddleware`, which shares it only on effective-guard pages.
 */
export default function MasqueradeBanner() {
  const { masquerade } = usePage().props as { masquerade?: MasqueradeStatus }
  if (!masquerade?.isMasquerading) return null
  return (
    <aside className="masquerade-banner" role="status" aria-live="polite">
      <p>You are viewing as account {masquerade.targetId}.</p>
      <p>Access: {masquerade.access === 'edit' ? 'Can edit' : 'View only'}.</p>
      <p>
        Fixed deadline:{' '}
        <time dateTime={masquerade.expiresAt}>
          {new Date(masquerade.expiresAt).toLocaleString()}
        </time>
      </p>
      <Form route="masquerade.stop">
        <input type="hidden" name="_masqueradeContext" value={masquerade.contextToken} />
        <button type="submit" className="btn btn--secondary btn--sm">
          Stop masquerade
        </button>
      </Form>
    </aside>
  )
}
