import {
  E_MASQUERADE_INVALID_LUCID_STORE,
  E_MASQUERADE_OPERATOR_INPUT_INVALID,
  E_MASQUERADE_STORE_RETIRED,
} from '../src/errors.js'
import { setTimeout } from 'node:timers/promises'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { isValidInstant, requireValidModeRow } from '../src/row_validation.js'
import { assertValidTransition } from '../src/transition_validation.js'
import { assertControlOutcome } from '../src/control_outcome_validation.js'
import type {
  CasOutcome,
  CompareAndSetInput,
  ControlOutcomeEvent,
  ControlStore,
  Instant,
  ModeRow,
  OwnerKey,
} from '../src/types.js'
import {
  decodeRow,
  buildAuditRecord,
  ownerColumns,
  buildOwnerRecord,
  buildModeRecord,
} from './lucid_row.js'
export {
  createMasqueradeSchemaV1,
  dropMasqueradeSchemaV1,
  createMasqueradeSchemaV1 as createMasqueradeSchema,
  dropMasqueradeSchemaV1 as dropMasqueradeSchema,
} from './lucid_schema.js'

/** The Lucid query client surface the store uses: a connection or a transaction. */
export type LucidControlClient = Pick<
  QueryClientContract,
  'getWriteClient' | 'knexQuery' | 'dialect' | 'isTransaction' | 'mode'
>
/** SQLite busy-lock retry tuning for the Lucid store; PostgreSQL ignores it. */
export interface LucidControlStoreOptions {
  /** Retries after `SQLITE_BUSY` or `SQLITE_LOCKED`; defaults to 3. */
  sqliteBusyRetries?: number
  /** Delay between those retries in milliseconds; defaults to 10. */
  sqliteBusyDelayMs?: number
}
function isBusyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED'].includes(String(error.code))
  )
}
function isDefiniteCommitFailure(error: unknown): boolean {
  if (isBusyError(error)) return true
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return (
    /^23\d{3}$/.test(code) ||
    ['40001', '40P01', 'SQLITE_CONSTRAINT'].some((value) => code.startsWith(value))
  )
}
/** PostgreSQL serialization failure or deadlock: a concurrent change won, so the CAS lost. */
function isSerializationFailure(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return code === '40001' || code === '40P01'
}
function assertBatchInput(input: { limit: number }, instant: Instant): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || !isValidInstant(instant))
    throw new E_MASQUERADE_OPERATOR_INPUT_INVALID()
}
/**
 * Inject db.connection() in write mode; transaction clients and read replicas are unsupported.
 *
 * @example
 * ```ts
 * import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
 * import db from '@adonisjs/lucid/services/db'
 *
 * export const supportStore = new LucidControlStore(db.connection(), {
 *   sqliteBusyRetries: 5,
 * })
 * ```
 */
export class LucidControlStore implements ControlStore {
  readonly #client: LucidControlClient
  readonly #retries: number
  readonly #delay: number
  #failed = false
  #assertAvailable(): void {
    if (this.#failed) throw new E_MASQUERADE_STORE_RETIRED()
  }
  #retireWritePool(knex: ReturnType<LucidControlClient['getWriteClient']>): void {
    if (this.#failed) return
    this.#failed = true
    // Block new checkouts synchronously and let existing owners drain. Awaiting shutdown while
    // this operation still owns a checkout can deadlock.
    void knex.destroy().catch(() => {})
  }
  constructor(client: LucidControlClient, options: LucidControlStoreOptions = {}) {
    this.#client = client
    this.#retries = options.sqliteBusyRetries ?? 3
    this.#delay = options.sqliteBusyDelayMs ?? 10
    if (
      client.isTransaction ||
      client.mode === 'read' ||
      !['sqlite3', 'better-sqlite3', 'postgres'].includes(client.dialect.name) ||
      !Number.isInteger(this.#retries) ||
      this.#retries < 0 ||
      this.#retries > 10 ||
      !Number.isInteger(this.#delay) ||
      this.#delay < 0 ||
      this.#delay > 1000 ||
      client.getWriteClient().client.config.connectionPool !== undefined
    )
      throw new E_MASQUERADE_INVALID_LUCID_STORE()
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
    this.#assertAvailable()
    const raw = await this.#client
      .knexQuery()
      .from('masquerade_modes')
      .where(buildOwnerRecord(owner))
      .first()
    return raw ? decodeRow(raw, owner) : null
  }
  /**
   * Replace an expected mode row and append its transition event together.
   * @throws {AggregateError} When a failed transaction and its cleanup both fail, with the transaction first.
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
    this.#assertAvailable()
    requireValidModeRow(input.next, input.owner)
    const transitionInput = structuredClone(input)
    for (let attempt = 0; ; attempt++) {
      const knex = this.#client.getWriteClient()
      const connection = await knex.client.acquireConnection()
      let transaction: TransactionClientContract['knexClient'] | undefined
      let completion: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined
      let committing = false
      let rollingBack = false
      let workFailure: { error: unknown; cleanup: unknown[] } | undefined
      try {
        transaction = await knex.transaction({ connection })
        completion = transaction.executionPromise.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error })
        )
        const query = transaction.table('masquerade_modes')
        const currentRaw = await transaction
          .from('masquerade_modes')
          .where(buildOwnerRecord(transitionInput.owner))
          .forUpdate()
          .first()
        const current = currentRaw ? decodeRow(currentRaw, transitionInput.owner) : null
        if ((current?.revision ?? null) === transitionInput.expected)
          assertValidTransition(transitionInput, current)
        const changed =
          transitionInput.expected === null
            ? await query
                .insert(buildModeRecord(transitionInput.next))
                .onConflict(ownerColumns)
                .ignore()
                .returning('revision')
            : await query
                .where(buildOwnerRecord(transitionInput.owner))
                .where('revision', transitionInput.expected)
                .update(buildModeRecord(transitionInput.next))
                .returning('revision')
        if (changed.length === 0) {
          rollingBack = true
          await transaction.rollback()
          const outcome = await completion
          if (!outcome.ok) throw outcome.error
          return { status: 'conflict' }
        }
        await transaction.table('masquerade_events').insert(buildAuditRecord(transitionInput.event))
        committing = true
        await transaction.commit()
        const outcome = await completion
        if (!outcome.ok) throw outcome.error
        return { status: 'applied', transitionId: transitionInput.event.id }
      } catch (error) {
        const workFailed = !rollingBack
        const expectedConflict =
          this.#client.dialect.name === 'postgres' && isSerializationFailure(error)
        const unknownCommit = committing && !isDefiniteCommitFailure(error)
        try {
          if (transaction && !transaction.isCompleted()) {
            rollingBack = true
            await transaction.rollback()
          }
          if (completion) {
            const outcome = await completion
            if (!outcome.ok && rollingBack) throw outcome.error
          }
          // A failed SQLite COMMIT can leave a native transaction open even
          // though Knex considers it complete. We still own the pool checkout.
          if (transaction && this.#client.dialect.name !== 'postgres') {
            try {
              await knex.raw('ROLLBACK').connection(connection)
            } catch (cleanupError) {
              if (
                !(cleanupError instanceof Error) ||
                !cleanupError.message.includes('no transaction is active')
              )
                throw cleanupError
            }
          }
        } catch (cleanupError) {
          if (this.#client.dialect.name === 'postgres') {
            // PostgreSQL discards an open transaction with its session, so a failed ROLLBACK
            // retires only this connection (Knex destroys a disposed connection on release).
            // The shared pool and this store stay available.
            ;(connection as { __knex__disposed?: unknown }).__knex__disposed ??= cleanupError
          } else {
            this.#retireWritePool(knex)
          }
          if (unknownCommit)
            return { status: 'indeterminate', transitionId: transitionInput.event.id }
          if (expectedConflict) throw cleanupError
          if (!workFailed) throw error
          workFailure = { error, cleanup: error === cleanupError ? [] : [cleanupError] }
        }
        if (!workFailure) {
          if (unknownCommit)
            return { status: 'indeterminate', transitionId: transitionInput.event.id }
          // A PostgreSQL serialization failure after a clean rollback is a CAS conflict.
          if (expectedConflict) return { status: 'conflict' }
          if (!(
            this.#client.dialect.name !== 'postgres' &&
            isBusyError(error) &&
            attempt < this.#retries
          )) {
            if (!workFailed) throw error
            workFailure = { error, cleanup: [] }
          }
        }
      } finally {
        try {
          await knex.client.releaseConnection(connection)
        } catch (cleanupError) {
          if (workFailure) workFailure.cleanup.push(cleanupError)
          this.#retireWritePool(knex)
          // Report cleanup independently so it cannot change the transaction result.
          void Promise.resolve()
            .then(() =>
              knex.client.logger.error('Masquerade could not release the control store connection')
            )
            .catch(() => {})
        }
      }
      if (workFailure) {
        if (workFailure.cleanup.length)
          throw new AggregateError(
            [workFailure.error, ...workFailure.cleanup],
            'Mode transition and cleanup both failed'
          )
        throw workFailure.error
      }
      this.#assertAvailable()
      await setTimeout(this.#delay)
    }
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
    this.#assertAvailable()
    assertControlOutcome(event)
    await this.#client.knexQuery().table('masquerade_events').insert(buildAuditRecord(event))
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
    this.#assertAvailable()
    assertBatchInput(input, input.now)
    const rows = await this.#client
      .knexQuery()
      .from('masquerade_modes')
      .where('state', 'active')
      .where('expires_at', '<=', input.now)
      .orderBy('updated_at')
      .orderBy(ownerColumns)
      .limit(input.limit)
    return rows.map((row: Record<string, unknown>) => decodeRow(row))
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
    this.#assertAvailable()
    if (!Number.isSafeInteger(input.limit) || input.limit < 1)
      throw new E_MASQUERADE_OPERATOR_INPUT_INVALID()
    const rows = await this.#client
      .knexQuery()
      .from('masquerade_modes')
      .where('state', 'active')
      .orderBy('updated_at')
      .orderBy(ownerColumns)
      .limit(input.limit)
    return rows.map((row: Record<string, unknown>) => decodeRow(row))
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
    this.#assertAvailable()
    assertBatchInput(input, input.before)
    // One statement avoids double-counting events deleted by a concurrent pruner.
    const selected = this.#client
      .knexQuery()
      .from('masquerade_events')
      .select('id')
      .where('at', '<', input.before)
      .orderBy('at')
      .orderBy('id')
      .limit(input.limit)
    return Number(
      await this.#client.knexQuery().from('masquerade_events').whereIn('id', selected).delete()
    )
  }
}
