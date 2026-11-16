export interface CurrentAccountSnapshot<User> {
  subject: { id: string; incarnation: string; user: User }
}

/** Return a current account only when the history row proves the same identity still owns the ID. */
export async function currentAccountForAuditIdentity<User>(
  id: string | null,
  incarnation: string | null,
  inspectAccount: (id: string) => Promise<CurrentAccountSnapshot<User> | null>
): Promise<User | null> {
  if (id === null || incarnation === null) return null

  const snapshot = await inspectAccount(id)
  if (
    snapshot === null ||
    snapshot.subject.id !== id ||
    snapshot.subject.incarnation !== incarnation
  )
    return null

  return snapshot.subject.user
}
