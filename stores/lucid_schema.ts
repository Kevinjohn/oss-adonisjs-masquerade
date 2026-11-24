import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Create the v1 tables. Keep this contract fixed for existing migrations.
 * UTC instants use canonical ISO text for millisecond precision and identical ordering on both engines.
 *
 * @example
 * ```ts
 * import { createMasqueradeSchemaV1 } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
 * import { BaseSchema } from '@adonisjs/lucid/schema'
 *
 * export default class MasqueradeTables extends BaseSchema {
 *   async up() {
 *     createMasqueradeSchemaV1(this.schema)
 *   }
 * }
 * ```
 */
export function createMasqueradeSchemaV1(
  schema: QueryClientContract['schema']
): QueryClientContract['schema'] {
  return schema
    .createTable('masquerade_modes', (table) => {
      table.string('authority_namespace', 128).notNullable()
      table.string('actor_id', 255).notNullable()
      table.string('actor_incarnation', 128).notNullable()
      // A primary key, not only a unique index, gives PostgreSQL logical replication a replica
      // identity, so UPDATEs succeed in databases with a FOR ALL TABLES publication.
      table.primary(
        ['authority_namespace', 'actor_id', 'actor_incarnation'],
        'masquerade_modes_owner_unique'
      )
      table.bigInteger('revision').notNullable()
      table.string('revision_nonce', 32).notNullable()
      table.string('state', 6).notNullable()
      table.string('access', 8).nullable()
      table.string('mode_id', 36).notNullable()
      table.string('last_transition_id', 36).notNullable()
      table.string('target_id', 255).nullable()
      table.string('target_incarnation', 128).nullable()
      table.string('actor_stamp_hash', 64).nullable()
      table.string('target_stamp_hash', 64).nullable()
      table.text('reason').nullable()
      table.string('started_at', 24).nullable()
      table.string('expires_at', 24).nullable()
      table.string('updated_at', 24).notNullable()
      table.index(['state', 'expires_at', 'updated_at'], 'masquerade_modes_expiry_index')
    })
    .createTable('masquerade_events', (table) => {
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
    })
}
/**
 * Roll back the v1 tables. Keep this contract fixed for existing migrations.
 *
 * @example
 * ```ts
 * import { dropMasqueradeSchemaV1 } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
 * import { BaseSchema } from '@adonisjs/lucid/schema'
 *
 * export default class MasqueradeTables extends BaseSchema {
 *   async down() {
 *     dropMasqueradeSchemaV1(this.schema)
 *   }
 * }
 * ```
 */
export function dropMasqueradeSchemaV1(
  schema: QueryClientContract['schema']
): QueryClientContract['schema'] {
  return schema.dropTable('masquerade_events').dropTable('masquerade_modes')
}
