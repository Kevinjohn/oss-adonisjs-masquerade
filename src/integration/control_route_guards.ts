/** Guards that `masqueradeRoutes` mounted the control routes on, per router. */
class ControlRouteGuards {
  #guardsByRouter = new WeakMap<object, Set<string>>()

  /** Remember a control route guard so the provider can check, once auth is resolved, that it is raw. */
  recordControlRouteGuard(router: object, guard: string): void {
    const guards = this.#guardsByRouter.get(router) ?? new Set<string>()
    guards.add(guard)
    this.#guardsByRouter.set(router, guards)
  }

  /** The guards `masqueradeRoutes` mounted control routes on for this router. */
  listControlRouteGuards(router: object): readonly string[] {
    return [...(this.#guardsByRouter.get(router) ?? [])]
  }
}

export const controlRouteGuards = new ControlRouteGuards()
