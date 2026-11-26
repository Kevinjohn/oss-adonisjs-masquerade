import { BaseSchema } from '@adonisjs/lucid/schema'
import { createMasqueradeModesTableV1 } from '@kevinjohn/adonisjs-masquerade/stores/lucid'

export default class extends BaseSchema {
  protected tableName = 'masquerade_modes'

  async up() {
    this.schema.createTable(this.tableName, createMasqueradeModesTableV1)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
