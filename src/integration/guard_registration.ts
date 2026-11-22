/** Registration identifies package factories without inspecting private auth state. */
const effectiveFactories = new WeakSet<object>()
const rawGuardsByFactory = new WeakMap<object, string>()
const driversByFactory = new WeakMap<object, NativeGuardDriver>()
/** Native Auth transport an effective guard wraps, compared with the raw adapter's `driverName`. */
export type NativeGuardDriver = 'session' | 'access_tokens'
export function markEffectiveFactory<Factory extends (...args: never[]) => unknown>(
  factory: Factory,
  rawGuard?: string,
  driver?: NativeGuardDriver
): Factory {
  effectiveFactories.add(factory)
  if (rawGuard) rawGuardsByFactory.set(factory, rawGuard)
  if (driver) driversByFactory.set(factory, driver)
  return factory
}
/**
 * Transport recorded when the effective guard factory was defined, or `undefined` for a factory
 * without that metadata, which boot rejects.
 */
export function effectiveFactoryDriver(factory: unknown): NativeGuardDriver | undefined {
  return typeof factory === 'function' ? driversByFactory.get(factory) : undefined
}
export function isEffectiveFactory(factory: unknown): boolean {
  return typeof factory === 'function' && effectiveFactories.has(factory)
}
export function effectiveFactoryRawGuard(factory: unknown): string | undefined {
  return typeof factory === 'function' ? rawGuardsByFactory.get(factory) : undefined
}
