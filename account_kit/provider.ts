import type { ApplicationService } from '@adonisjs/core/types'
import { AccountKitBlocker } from './middleware.js'
import type { AccountKitAdapter } from './main.js'
import { assertManagedRouteRegistration } from './route_validation.js'
import { recordAccountKitBlocker } from '../src/integration/account_kit_status.js'
import { managedRegistration } from './registration.js'

async function installed(
  domains: Record<string, { name?: string; middleware: { all(): Set<unknown> } }[]>
): Promise<boolean> {
  const managed = Object.values(domains)
    .flat()
    .filter((route) => route.name?.startsWith('accountKit.'))
  if (!managed.length) return false
  for (const route of managed) {
    let found = false
    for (const item of route.middleware.all()) {
      if (item === AccountKitBlocker) {
        found = true
        continue
      }
      if (!item || typeof item !== 'object' || !('reference' in item)) continue
      const reference = (item as { reference: unknown }).reference
      if (reference === AccountKitBlocker) {
        found = true
        continue
      }
      if (typeof reference !== 'function') continue
      if (/^class\s/.test(Function.prototype.toString.call(reference))) continue
      try {
        const loaded = await (reference as () => Promise<{ default?: unknown }>)()
        if (loaded?.default === AccountKitBlocker) found = true
      } catch {
        /* A class reference or an unrelated loader is not the blocker. */
      }
    }
    if (!found) return false
  }
  return true
}

/** Validates the Account Kit guard and registered routes after HTTP router startup. */
export default class AccountKitProvider {
  constructor(protected app: ApplicationService) {}

  async ready(): Promise<void> {
    const adapter = (await this.app.container.make(
      'masquerade.native'
    )) as AccountKitAdapter<unknown>
    if (!adapter.kit || !adapter.managedGuard)
      throw new TypeError('Account Kit native adapter required')
    const kit = await adapter.kit()
    if (!kit.managedHttp?.assertGuard)
      throw new TypeError('Account Kit managed HTTP service required')
    kit.managedHttp.assertGuard(adapter.managedGuard)
    const router = await this.app.container.make('router')
    const registration = await managedRegistration(router)
    // Only the console lifecycle reaches ready before the router has committed. HTTP and test
    // lifecycles commit later themselves; committing early there would drop routes a test
    // registers after boot.
    if (this.app.getEnvironment() === 'console' && !router.commited) router.commit()
    // An uncommitted router has nothing to check yet; the blocker validates registration on each
    // managed request until the HTTP lifecycle reaches ready with a committed router.
    if (!router.commited) return
    const domains = router.toJSON()
    assertManagedRouteRegistration(domains, registration)
    const mounted = Object.values(domains)
      .flat()
      .some((route) => route.name?.startsWith('accountKit.'))
    if (!mounted) return
    if (!(await installed(domains)))
      throw new TypeError('Account Kit blocker middleware is missing')
    recordAccountKitBlocker(this.app)
  }
}
