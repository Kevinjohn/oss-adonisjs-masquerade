import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'support_accounts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('account_key', 128).primary()
      table.boolean('active').notNullable()
      table.string('security_stamp', 128).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
