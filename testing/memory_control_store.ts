import { RuntimeException } from '@adonisjs/core/exceptions'
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
import { assertValidTransition } from '../src/transition_validation.js'
import { assertControlOutcome } from '../src/control_outcome_validation.js'
import { requireValidModeRow } from '../src/row_validation.js'

function key(owner: OwnerKey): string {
  return JSON.stringify([owner.namespace, owner.actorId, owner.actorIncarnation])
}
/**
 * Test-only atomic in-process implementation. Never use as a deployment store.
 *
 * @example
 * ```ts
 * import { MemoryControlStore } from '@kevinjohn/adonisjs-masquerade/testing'
 *
 * const store = new MemoryControlStore()
 * const owner = { namespace: 'users', actorId: 'support-operator', actorIncarnation: '1' }
 * const row = await store.read(owner)
 * ```
 */
export class MemoryControlStore implements ControlStore {
  readonly testOnly = true
  #rows = new Map<string, ModeRow>()
  #events: AuditEvent[] = []
  get events(): AuditEvent[] {
    return structuredClone(this.#events)
  }
  /**
   * Read the latest mode row for one owner.
   *
   * @example
   * ```ts
   * const row = await store.read({
   *   namespace: 'users',
   *   actorId: 'support-operator',
   *   actorIncarnation: '1',
   * })
   * ```
   */
  async read(owner: OwnerKey): Promise<ModeRow | null> {
    return structuredClone(this.#rows.get(key(owner)) ?? null)
  }
  /**
   * Replace an expected mode row and append its transition event together.
   *
   * @example
   * ```ts
   * const outcome = await store.compareAndSet({
   *   owner,
   *   expected: current?.revision ?? null,
   *   next,
   *   event,
   * })
   * ```
   */
  async compareAndSet(input: CompareAndSetInput): Promise<CasOutcome> {
    // The same row checks as the Lucid store, so tests cannot pass with rows a database rejects.
    requireValidModeRow(input.next, input.owner)
    const current = this.#rows.get(key(input.owner))
    if ((current?.revision ?? null) !== input.expected) return { status: 'conflict' }
    assertValidTransition(input, current ?? null)
    if (this.#events.some((event) => event.id === input.event.id))
      throw new RuntimeException('Duplicate audit event ID')
    const next = structuredClone(input.next)
    const event = structuredClone(input.event)
    this.#rows.set(key(input.owner), next)
    this.#events.push(event)
    return { status: 'applied', transitionId: event.id }
  }
  /**
   * Append a control outcome without changing the mode row.
   *
   * @example
   * ```ts
   * await store.recordControlOutcome(deniedStart)
   * ```
   */
  async recordControlOutcome(event: ControlOutcomeEvent): Promise<void> {
    assertControlOutcome(event)
    if (this.#events.some((existing) => existing.id === event.id))
      throw new RuntimeException('Duplicate audit event ID')
    this.#events.push(structuredClone(event))
  }
  /**
   * Fetch one bounded batch of expired mode rows.
   *
   * @example
   * ```ts
   * const expired = await store.expiredBatch({ now: new Date().toISOString(), limit: 100 })
   * ```
   */
  async expiredBatch(input: { now: Instant; limit: number }): Promise<ModeRow[]> {
    return structuredClone(
      [...this.#rows.values()]
        .filter((row) => row.state === 'active' && row.expiresAt <= input.now)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, input.limit)
    )
  }
  /**
   * Fetch one bounded batch of active mode rows.
   *
   * @example
   * ```ts
   * const active = await store.activeBatch({ limit: 100 })
   * ```
   */
  async activeBatch(input: { limit: number }): Promise<ModeRow[]> {
    return structuredClone(
      [...this.#rows.values()]
        .filter((row) => row.state === 'active')
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, input.limit)
    )
  }
  /**
   * Delete a bounded batch of old audit events.
   *
   * @example
   * ```ts
   * const deleted = await store.pruneEvents({ before: '2026-01-01T00:00:00.000Z', limit: 100 })
   * ```
   */
  async pruneEvents(input: { before: Instant; limit: number }): Promise<number> {
    let count = 0
    this.#events = this.#events.filter(
      (event) => !(event.at < input.before && count++ < input.limit)
    )
    return Math.min(count, input.limit)
  }
}
