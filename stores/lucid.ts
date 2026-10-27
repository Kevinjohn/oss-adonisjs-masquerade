import { setTimeout } from 'node:timers/promises'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { unavailable } from '../src/errors.js'
import { validInstant, validateRow } from '../src/row_validation.js'
import { validateTransition } from '../src/transition_validation.js'
import type {
  AuditEvent,
  CasOutcome,
  CompareAndSetInput,
  ControlStore,
  Instant,
  ModeRow,
  OwnerKey,
} from '../src/types.js'
import { decodeRow, eventRecord, ownerColumns, ownerRecord, rowRecord } from './lucid_row.js'
export { createMasqueradeSchema, dropMasqueradeSchema } from './lucid_schema.js'

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
function busy(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED'].includes(String(error.code))
  )
}
function definiteCommitFailure(error: unknown): boolean {
  if (busy(error)) return true
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return (
    /^23\d{3}$/.test(code) ||
    ['40001', '40P01', 'SQLITE_CONSTRAINT'].some((value) => code.startsWith(value))
  )
}
function batch(input: { limit: number }, instant: Instant): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || !validInstant(instant))
    throw unavailable()
}
/** Inject db.connection() in write mode; transaction clients and read replicas are unsupported. */
export class LucidControlStore implements ControlStore {
  readonly #client: LucidControlClient
  readonly #retries: number
  readonly #delay: number
  #failed = false
  #assertAvailable(): void {
    if (this.#failed) throw unavailable()
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
      throw unavailable()
  }
  async read(owner: OwnerKey): Promise<ModeRow | null> {
    this.#assertAvailable()
    const raw = await this.#client
      .knexQuery()
      .from('masquerade_modes')
      .where(ownerRecord(owner))
      .first()
    return raw ? decodeRow(raw, owner) : null
  }
  async compareAndSet(input: CompareAndSetInput): Promise<CasOutcome> {
    this.#assertAvailable()
    validateRow(input.next, input.owner)
    const command = structuredClone(input)
    for (let attempt = 0; ; attempt++) {
      const knex = this.#client.getWriteClient()
      const connection = await knex.client.acquireConnection()
      let transaction: TransactionClientContract['knexClient'] | undefined
      let completion: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined
      let committing = false
      let rollingBack = false
      try {
        transaction = await knex.transaction({ connection })
        completion = transaction.executionPromise.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error })
        )
        const query = transaction.table('masquerade_modes')
        const currentRaw = await transaction
          .from('masquerade_modes')
          .where(ownerRecord(command.owner))
          .forUpdate()
          .first()
        const current = currentRaw ? decodeRow(currentRaw, command.owner) : null
        if ((current?.revision ?? null) === command.expected) validateTransition(command, current)
        const changed =
          command.expected === null
            ? await query
                .insert(rowRecord(command.next))
                .onConflict(ownerColumns)
                .ignore()
                .returning('revision')
            : await query
                .where(ownerRecord(command.owner))
                .where('revision', command.expected)
                .update(rowRecord(command.next))
                .returning('revision')
        if (changed.length === 0) {
          rollingBack = true
          await transaction.rollback()
          const outcome = await completion
          if (!outcome.ok) throw outcome.error
          return { status: 'conflict' }
        }
        await transaction.table('masquerade_events').insert(eventRecord(command.event))
        committing = true
        await transaction.commit()
        const outcome = await completion
        if (!outcome.ok) throw outcome.error
        return { status: 'applied', transitionId: command.event.id }
      } catch (error) {
        const unknownCommit = committing && !definiteCommitFailure(error)
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
          this.#failed = true
          // Public destroy blocks new checkouts synchronously. Existing work
          // drains asynchronously: awaiting it here could deadlock a checkout
          // whose owner is waiting for this CAS. Observe rejection immediately.
          void knex.destroy().catch(() => {})
          if (unknownCommit) return { status: 'indeterminate', transitionId: command.event.id }
          throw cleanupError
        }
        if (unknownCommit) return { status: 'indeterminate', transitionId: command.event.id }
        if (this.#client.dialect.name !== 'postgres' && busy(error) && attempt < this.#retries) {
          await setTimeout(this.#delay)
          continue
        }
        throw error
      } finally {
        await knex.client.releaseConnection(connection)
      }
    }
  }
  async recordControlOutcome(event: AuditEvent): Promise<void> {
    this.#assertAvailable()
    await this.#client.knexQuery().table('masquerade_events').insert(eventRecord(event))
  }
  async expiredBatch(input: { now: Instant; limit: number }): Promise<ModeRow[]> {
    this.#assertAvailable()
    batch(input, input.now)
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
  async activeBatch(input: { limit: number }): Promise<ModeRow[]> {
    this.#assertAvailable()
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw unavailable()
    const rows = await this.#client
      .knexQuery()
      .from('masquerade_modes')
      .where('state', 'active')
      .orderBy('updated_at')
      .orderBy(ownerColumns)
      .limit(input.limit)
    return rows.map((row: Record<string, unknown>) => decodeRow(row))
  }
  async pruneEvents(input: { before: Instant; limit: number }): Promise<number> {
    this.#assertAvailable()
    batch(input, input.before)
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
