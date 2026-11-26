import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'recipe_preferences'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.boolean('enabled').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
