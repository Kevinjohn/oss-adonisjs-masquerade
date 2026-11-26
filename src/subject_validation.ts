import { E_MASQUERADE_UNAVAILABLE } from './errors.ts'
import { isBoundedString } from './bounded_string.ts'
import type { Subject, NativeAuthority } from './types.ts'

export function requireValidSubject<User>(
  subject: Subject<User>,
  authority: NativeAuthority<User>
): Subject<User> {
  if (!subject || !isBoundedString(subject.id, 255) || !isBoundedString(subject.incarnation, 128))
    throw new E_MASQUERADE_UNAVAILABLE()
  const incarnation =
    authority.incarnation === 'id' ? subject.id : authority.incarnation(subject.user)
  if (!isBoundedString(incarnation, 128) || incarnation !== subject.incarnation)
    throw new E_MASQUERADE_UNAVAILABLE()
  return subject
}
