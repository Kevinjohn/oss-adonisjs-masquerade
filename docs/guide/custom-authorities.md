# Custom authorities

The native adapter and its exported contract are documented under `adonisjs-masquerade/native`;
shared package types such as `NativeAuthority` are available from `adonisjs-masquerade/types` in the
[API entry-point map](../api-reference.md#supported-package-imports).

The built-in native-session authority is the recommended integration. If you provide a custom
`NativeAuthority`, its `securityStamp(user)` callback and the `securityStamp` returned by
`inspectAccount(id)` must describe the same current security epoch for an account.

Masquerade calls `securityStamp(user)` when a mode starts and stores a hash of that value. On each
active business admission, it reads `inspectAccount(id)` for the actor and target and compares the
hash of each inspected snapshot's stamp with the hash captured at start. If the two callbacks derive
different values for the same account state, the first active admission clears the mode as globally
invalid and rejects that request. An older inspected epoch invalidates the mode only if it differs
from the stamp captured at start. If inspection keeps returning the captured epoch after the
authoritative account changes, it can conceal revocation and leave the mode admitted. Always read
the current authoritative epoch rather than a stale cache.

Derive both values from one persisted account epoch. For example, if the host stores an incrementing
`securityEpoch` on the account row:

```ts
import type { AccountSnapshot, NativeAuthority } from 'adonisjs-masquerade/types'

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
  securityStamp: accountStamp,
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

Read the account and its epoch as one coherent current snapshot. The inspection path must not use a
stale cache, a separate version source, or a different encoding from `securityStamp`. A single
helper such as `accountStamp` helps keep both paths aligned; the shared persisted epoch is the
contract.

Advance the epoch whenever the host wants every active mode for that account invalidated. Typical
changes include a password reset or change, account suspension or reactivation, privilege changes,
and a logout-all action. Logging out one session normally remains a native credential operation
and does not advance this account-wide epoch. The host owns the policy for which changes revoke all
devices.

The callback returns an opaque, non-empty string of at most 512 UTF-8 bytes. Do not return a
constant, a read-time timestamp, or a value derived from only some of the security-sensitive
account state. See [security and operations](security.md#actor-target-and-scope) for the broader
stamp and session behavior.
