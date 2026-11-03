export interface ManagedRegistration {
  routes: readonly { name: string; method: string; path: string }[]
}

/** Resolve the optional peer lazily from the host's installed package instance. */
export async function managedRegistration(
  router: unknown
): Promise<ManagedRegistration | undefined> {
  const packagePath = '@kevinjohn/adonisjs-account-kit/http'
  const { managedRouteRegistration } = (await import(packagePath)) as {
    managedRouteRegistration(value: unknown): ManagedRegistration | undefined
  }
  return managedRouteRegistration(router)
}
