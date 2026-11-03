import { unavailable } from './error_helpers.js'
import { boundedString } from './bounded_string.js'
import type { Subject, NativeAuthority } from './types.js'

export function validateSubject<User>(
  subject: Subject<User>,
  authority: NativeAuthority<User>
): Subject<User> {
  if (!subject || !boundedString(subject.id, 255) || !boundedString(subject.incarnation, 128))
    throw unavailable()
  const incarnation =
    authority.incarnation === 'id' ? subject.id : authority.incarnation(subject.user)
  if (!boundedString(incarnation, 128) || incarnation !== subject.incarnation) throw unavailable()
  return subject
}
