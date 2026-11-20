# Custom authorities

The native adapter and its exported contract are documented under `@kevinjohn/adonisjs-masquerade/native`;
shared package types such as `NativeAuthority` are available from `@kevinjohn/adonisjs-masquerade/types` in the
[API entry-point map](https://kevinjohn.github.io/oss-adonisjs-masquerade/reference/index#supported-package-imports).

The built-in native-session authority is the recommended integration. A custom
`NativeAuthority` returns the current security epoch in the snapshot from `inspectAccount(id)`.
Masquerade hashes that value at start and compares both accounts’ inspected stamps on every active
business admission. Existing custom configurations may keep the legacy `securityStamp(user)` method.
Core no longer calls it. Native adapter options still use their `securityStamp` callback to build
the snapshot. Consumers of the Account Kit adapter can read the stamp from the awaited `inspectAccount(id)` snapshot.

For example, if the host stores an incrementing
`securityEpoch` on the account row:

```ts
import type { AccountSnapshot, NativeAuthority } from '@kevinjohn/adonisjs-masquerade/types'

type User = {
  id: string
  securityEpoch: number
  active: boolean
  // Other application fields
}

const accountStamp = (user: User) => String(user.securityEpoch)

export const authority: NativeAuthority<User> = {
  namespace: 'my_app',
  guard: 'web',
  incarnation: 'id', // Only if this application never reuses account IDs
  async inspectAccount(id): Promise<AccountSnapshot<User> | null> {
    const user = await UserModel.find(id)
    if (!user) return null

    return {
      subject: {
        id: String(user.id),
        incarnation: String(user.id),
        user,
      },
      securityStamp: accountStamp(user),
      active: user.active,
    }
  },
}
```

Read the account and its epoch as one coherent current snapshot. A stale cache can conceal
revocation if it keeps returning the epoch captured at start.

Advance the epoch whenever the host wants every active mode for that account invalidated. Typical
changes include a password reset or change, account suspension or reactivation, privilege changes,
and a logout-all action. Logging out one session normally remains a native credential operation
and does not advance this account-wide epoch. The host owns the policy for which changes revoke all
devices.

The snapshot stamp is an opaque, non-empty string of at most 512 UTF-8 bytes. Do not return a
constant, a read-time timestamp, or a value derived from only some of the security-sensitive
account state. See [security and operations](security.md#actor-target-and-scope) for the broader
stamp and session behavior.
