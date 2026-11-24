import { E_MASQUERADE_AUDIT_OUTCOME_INVALID } from './errors.js'
import type { ControlOutcomeEvent } from './types.js'

const outcomeKinds = new Set(['start_denied', 'stop_denied', 'control_noop'])

/** A control outcome is audit only: it never carries a transition kind or changes a mode row. */
export function assertControlOutcome(event: ControlOutcomeEvent): void {
  if (!event || !outcomeKinds.has(event.kind)) throw new E_MASQUERADE_AUDIT_OUTCOME_INVALID()
}
