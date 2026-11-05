/** Guards that `masqueradeRoutes` mounted the control routes on, per router. */
const guardsByRouter = new WeakMap<object, Set<string>>()

/** Remember a control route guard so the provider can check, once auth is resolved, that it is raw. */
export function recordControlRouteGuard(router: object, guard: string): void {
  const guards = guardsByRouter.get(router) ?? new Set<string>()
  guards.add(guard)
  guardsByRouter.set(router, guards)
}

/** The guards `masqueradeRoutes` mounted control routes on for this router. */
export function controlRouteGuards(router: object): readonly string[] {
  return [...(guardsByRouter.get(router) ?? [])]
}
