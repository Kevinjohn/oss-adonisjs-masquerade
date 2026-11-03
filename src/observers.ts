import type {
  TransitionEvent,
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticOperation,
  ServiceDependencies,
} from './types.js'

export type ObserverDependencies = Pick<
  ServiceDependencies<unknown, unknown>,
  'emitter' | 'logger' | 'observerErrorHandler'
>

export function reportDiagnostic(
  dependencies: ObserverDependencies | undefined,
  category: DiagnosticCategory,
  operation: DiagnosticOperation,
  code: DiagnosticEvent['code']
): void {
  try {
    const event: DiagnosticEvent = {
      category,
      operation,
      code,
    }
    Promise.resolve(dependencies?.logger?.error(event)).catch(() => {})
  } catch {}
}

function reportFailure(dependencies: ObserverDependencies, error: unknown): void {
  try {
    Promise.resolve(dependencies.observerErrorHandler?.(error)).catch(() => {
      reportDiagnostic(dependencies, 'observer', 'error_reporter', 'E_MASQUERADE_UNAVAILABLE')
    })
  } catch {
    reportDiagnostic(dependencies, 'observer', 'error_reporter', 'E_MASQUERADE_UNAVAILABLE')
  }
}

/** Never await untrusted observers, including the failure reporter itself. */
export function observe(dependencies: ObserverDependencies, event: TransitionEvent): void {
  const safe = { ...event }
  delete safe.reason
  const projection = Object.freeze(safe)
  const report = (error: unknown) => reportFailure(dependencies, error)
  const invoke = (callback: () => unknown) => {
    try {
      Promise.resolve(callback()).catch(report)
    } catch (error) {
      report(error)
    }
  }
  invoke(() => dependencies.emitter?.emit(`masquerade:${event.kind}`, projection))
  invoke(() => dependencies.logger?.info(projection))
}
export function reportUnknown(dependencies: ObserverDependencies, transitionId: string): void {
  const event: DiagnosticEvent = {
    category: 'store',
    operation: 'compare_and_set',
    code: 'E_MASQUERADE_UNAVAILABLE',
    transitionId,
  }
  try {
    Promise.resolve(dependencies.logger?.error(event)).catch((error) =>
      reportFailure(dependencies, error)
    )
  } catch (error) {
    reportFailure(dependencies, error)
  }
}
