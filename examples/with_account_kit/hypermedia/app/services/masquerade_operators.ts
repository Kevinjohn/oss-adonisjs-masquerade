import env from '#start/env'

/**
 * Accounts whose email is listed in `MASQUERADE_OPERATOR_EMAILS` (comma-separated) may act as
 * other accounts. A missing or empty value means nobody. Tests add their own addresses here.
 */
export const masqueradeOperatorEmails = new Set(
  (env.get('MASQUERADE_OPERATOR_EMAILS') ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
)

export function isMasqueradeOperator(user: { email: string }) {
  return masqueradeOperatorEmails.has(user.email.toLowerCase())
}
