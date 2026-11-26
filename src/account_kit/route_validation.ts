import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
interface MountedRoute {
  name?: string
  methods: string[]
  pattern: string
}
interface RegisteredRoute {
  name: string
  method: string
  path: string
}

/**
 * Check names and method/path pairs across every committed router domain, and that every
 * registered route is mounted under its `accountKit.` name: a route group's own name prefix
 * would otherwise hide the route from the blocker.
 */
export function assertManagedRouteRegistration(
  domains: Record<string, MountedRoute[]>,
  registration: { routes: readonly RegisteredRoute[] } | undefined
): void {
  const expected = new Map(
    registration?.routes.map((route) => [`accountKit.${route.name}`, route]) ?? []
  )
  const mounted = new Set<string>()
  for (const routes of Object.values(domains)) {
    for (const route of routes) {
      if (!route.name?.startsWith('accountKit.')) continue
      const entry = expected.get(route.name)
      const allowed = entry?.method === 'GET' ? ['GET', 'HEAD'] : [entry?.method]
      if (
        !entry ||
        route.pattern !== entry.path ||
        !route.methods.includes(entry.method) ||
        route.methods.some((method) => !allowed.includes(method))
      )
        throw new InvalidArgumentsException(
          `Account Kit managed route ${route.name} is not registered`
        )
      mounted.add(route.name)
    }
  }
  for (const name of expected.keys())
    if (!mounted.has(name))
      throw new InvalidArgumentsException(`Account Kit managed route ${name} is not mounted`)
}
