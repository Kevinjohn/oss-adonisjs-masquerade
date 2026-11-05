type RouteMetadata = { middleware: { all(): Iterable<unknown> } }

/** Resolve omitted auth options once; an explicitly named "default" remains an ordinary guard. */
export function routeGuards(route: RouteMetadata | undefined, defaultGuardName: string): string[] {
  if (!route) return []
  const guards = new Set<string>()
  for (const middleware of route.middleware.all()) {
    if (typeof middleware !== 'object' || !middleware || !('name' in middleware)) continue
    const namedMiddleware = middleware as { name?: unknown; args?: unknown }
    if (namedMiddleware.name !== 'auth') continue
    const rawArgs = namedMiddleware.args
    const configured = Array.isArray(rawArgs) ? rawArgs[0] : rawArgs
    if (configured === undefined || configured === null) {
      guards.add(defaultGuardName)
      continue
    }
    if (typeof configured === 'object' && !Array.isArray(configured)) {
      const options = configured as { guards?: unknown }
      if (options.guards === undefined) {
        guards.add(defaultGuardName)
        continue
      }
      if (Array.isArray(options.guards)) {
        for (const guard of options.guards) if (typeof guard === 'string') guards.add(guard)
      }
      continue
    }
    if (Array.isArray(configured)) {
      if (configured.length === 0) guards.add(defaultGuardName)
      for (const guard of configured) if (typeof guard === 'string') guards.add(guard)
    }
  }
  return [...guards]
}

/** Whether the route carries the named `auth` middleware, even one that names no usable guard. */
export function hasAuthMiddleware(route: RouteMetadata | undefined): boolean {
  if (!route) return false
  return [...route.middleware.all()].some(
    (entry) =>
      typeof entry === 'object' && entry !== null && 'name' in entry && entry.name === 'auth'
  )
}
