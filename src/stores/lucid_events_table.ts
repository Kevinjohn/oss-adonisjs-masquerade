import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Define the fixed v1 events table columns and indexes. UTC instants use canonical ISO text.
 *
 * @example
 * ```ts
 * import { createMasqueradeEventsTableV1 } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
 * import { BaseSchema } from '@adonisjs/lucid/schema'
 *
 * export default class extends BaseSchema {
 *   protected tableName = 'masquerade_events'
 *
 *   async up() {
 *     this.schema.createTable(this.tableName, createMasqueradeEventsTableV1)
 *   }
 * }
 * ```
 */
export function createMasqueradeEventsTableV1(
  table: Parameters<Parameters<QueryClientContract['schema']['createTable']>[1]>[0]
): void {
  table.string('id', 36).primary()
  table.string('mode_id', 36).nullable()
  table.string('authority_namespace', 128).notNullable()
  table.string('actor_id', 255).notNullable()
  table.string('actor_incarnation', 128).notNullable()
  table.string('target_id', 255).nullable()
  table.string('target_incarnation', 128).nullable()
  table.string('at', 24).notNullable()
  table.string('kind', 32).notNullable()
  table.string('outcome_code', 128).notNullable()
  table.string('access', 8).nullable()
  table.bigInteger('revision').notNullable()
  table.text('reason').nullable()
  table.index(['at', 'id'], 'masquerade_events_retention_index')
}
