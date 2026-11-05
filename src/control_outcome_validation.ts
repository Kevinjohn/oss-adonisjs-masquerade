import { unavailable } from './error_helpers.js'
import type { ControlOutcomeEvent } from './types.js'

const outcomeKinds = new Set(['start_denied', 'stop_denied', 'control_noop'])

/** A control outcome is audit only: it never carries a transition kind or changes a mode row. */
export function validateControlOutcome(event: ControlOutcomeEvent): void {
  if (!event || !outcomeKinds.has(event.kind)) throw unavailable()
}
