/** Registration identifies package factories without inspecting private auth state. */
/** Native Auth transport an effective guard wraps, compared with the raw adapter's `driverName`. */
export type NativeGuardDriver = 'session' | 'access_tokens'

class GuardRegistration {
  #effectiveFactories = new WeakSet<object>()
  #rawGuardsByFactory = new WeakMap<object, string>()
  #driversByFactory = new WeakMap<object, NativeGuardDriver>()
  markEffectiveFactory<Factory extends (...args: never[]) => unknown>(
    factory: Factory,
    rawGuard?: string,
    driver?: NativeGuardDriver
  ): Factory {
    this.#effectiveFactories.add(factory)
    if (rawGuard) this.#rawGuardsByFactory.set(factory, rawGuard)
    if (driver) this.#driversByFactory.set(factory, driver)
    return factory
  }
  /**
   * Transport recorded when the effective guard factory was defined, or `undefined` for a factory
   * without that metadata, which boot rejects.
   */
  getEffectiveGuardDriver(factory: unknown): NativeGuardDriver | undefined {
    return typeof factory === 'function' ? this.#driversByFactory.get(factory) : undefined
  }
  isEffectiveFactory(factory: unknown): boolean {
    return typeof factory === 'function' && this.#effectiveFactories.has(factory)
  }
  getEffectiveFactoryRawGuard(factory: unknown): string | undefined {
    return typeof factory === 'function' ? this.#rawGuardsByFactory.get(factory) : undefined
  }
}

export const guardRegistration = new GuardRegistration()
