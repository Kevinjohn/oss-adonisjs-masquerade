import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  createMasqueradeSchemaV1,
  dropMasqueradeSchemaV1,
} from '@kevinjohn/adonisjs-masquerade/stores/lucid'

export default class extends BaseSchema {
  async up() {
    createMasqueradeSchemaV1(this.schema)
  }

  async down() {
    dropMasqueradeSchemaV1(this.schema)
  }
}
