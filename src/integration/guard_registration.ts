/** Registration identifies package factories without inspecting private auth state. */
const effectiveFactories = new WeakSet<object>()
const rawGuards = new WeakMap<object, string>()
export function markEffectiveFactory<Factory extends (...args: never[]) => unknown>(
  factory: Factory,
  rawGuard?: string
): Factory {
  effectiveFactories.add(factory)
  if (rawGuard) rawGuards.set(factory, rawGuard)
  return factory
}
export function isEffectiveFactory(factory: unknown): boolean {
  return typeof factory === 'function' && effectiveFactories.has(factory)
}
export function effectiveFactoryRawGuard(factory: unknown): string | undefined {
  return typeof factory === 'function' ? rawGuards.get(factory) : undefined
}
