import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('email').notNullable().unique()
      table.string('account_incarnation').notNullable()
      table.string('security_epoch').notNullable()
      table.boolean('active').notNullable()
      table.boolean('masquerade_operator').notNullable()
      table.boolean('can_mutate').notNullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
    this.schema.createTable('members', (table) => {
      table.increments('id').notNullable()
      table.string('email').notNullable()
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('members')
    this.schema.dropTable(this.tableName)
  }
}
