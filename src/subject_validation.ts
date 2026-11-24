import { E_MASQUERADE_UNAVAILABLE } from './errors.js'
import { isBoundedString } from './bounded_string.js'
import type { Subject, NativeAuthority } from './types.js'

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
