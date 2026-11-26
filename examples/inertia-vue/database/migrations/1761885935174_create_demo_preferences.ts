import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'demo_preferences'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.integer('user_id').primary().references('id').inTable('users').onDelete('CASCADE')
      table.boolean('email_updates').notNullable().defaultTo(false)
    })
  }
  async down() {
    this.schema.dropTable(this.tableName)
  }
}
