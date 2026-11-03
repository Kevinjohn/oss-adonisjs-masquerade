import type {
  AuditEvent,
  ControlOutcomeEvent,
  CompareAndSetInput,
  ControlStore,
  Instant,
  ModeRow,
  OwnerKey,
  CasOutcome,
} from '../src/types.js'
import { validateTransition } from '../src/transition_validation.js'

function key(owner: OwnerKey): string {
  return JSON.stringify([owner.namespace, owner.actorId, owner.actorIncarnation])
}
/** Test-only atomic in-process implementation. Never use as a deployment store. */
export class MemoryControlStore implements ControlStore {
  readonly testOnly = true
  #rows = new Map<string, ModeRow>()
  #events: AuditEvent[] = []
  get events(): AuditEvent[] {
    return structuredClone(this.#events)
  }
  async read(owner: OwnerKey): Promise<ModeRow | null> {
    return structuredClone(this.#rows.get(key(owner)) ?? null)
  }
  async compareAndSet(input: CompareAndSetInput): Promise<CasOutcome> {
    const current = this.#rows.get(key(input.owner))
    if ((current?.revision ?? null) !== input.expected) return { status: 'conflict' }
    validateTransition(input, current ?? null)
    const next = structuredClone(input.next)
    const event = structuredClone(input.event)
    this.#rows.set(key(input.owner), next)
    this.#events.push(event)
    return { status: 'applied', transitionId: event.id }
  }
  async recordControlOutcome(event: ControlOutcomeEvent): Promise<void> {
    this.#events.push(structuredClone(event))
  }
  async expiredBatch(input: { now: Instant; limit: number }): Promise<ModeRow[]> {
    return structuredClone(
      [...this.#rows.values()]
        .filter((row) => row.state === 'active' && row.expiresAt <= input.now)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, input.limit)
    )
  }
  async activeBatch(input: { limit: number }): Promise<ModeRow[]> {
    return structuredClone(
      [...this.#rows.values()]
        .filter((row) => row.state === 'active')
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, input.limit)
    )
  }
  async pruneEvents(input: { before: Instant; limit: number }): Promise<number> {
    let count = 0
    this.#events = this.#events.filter(
      (event) => !(event.at < input.before && count++ < input.limit)
    )
    return Math.min(count, input.limit)
  }
}
