import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  createMasqueradeSchema,
  dropMasqueradeSchema,
} from '@kevinjohn/adonisjs-masquerade/stores/lucid'

export default class extends BaseSchema {
  async up() {
    createMasqueradeSchema(this.schema)
  }
  async down() {
    dropMasqueradeSchema(this.schema)
  }
}
