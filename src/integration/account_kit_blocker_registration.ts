import { AccountKitAccountBlocker } from '../../account_kit/middleware.js'

/** Compare the actual named middleware export without constructing or running middleware. */
export async function hasRegisteredAccountKitBlocker(
  entries: Iterable<unknown>,
  imports: Map<Function, Promise<boolean>>
): Promise<boolean> {
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !('args' in entry) || !('reference' in entry))
      continue

    const { reference } = entry
    if (reference === AccountKitAccountBlocker) return true
    if (typeof reference !== 'function') continue

    let registered = imports.get(reference)
    if (!registered) {
      registered = loadMiddlewareReference(reference)
      imports.set(reference, registered)
    }
    if (await registered) return true
  }
  return false
}

async function loadMiddlewareReference(reference: Function): Promise<boolean> {
  try {
    const module: unknown = await reference()
    return (
      !!module &&
      typeof module === 'object' &&
      'default' in module &&
      module.default === AccountKitAccountBlocker
    )
  } catch {
    return false
  }
}
