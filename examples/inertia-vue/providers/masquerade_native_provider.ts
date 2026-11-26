import { NativeAdapter } from '@kevinjohn/adonisjs-masquerade/native'
import type { ApplicationService } from '@adonisjs/core/types'
import { nativeAdapter } from '#config/masquerade'

export default class MasqueradeNativeProvider {
  constructor(private readonly app: ApplicationService) {}

  register() {
    this.app.container.bindValue(NativeAdapter, nativeAdapter)
  }
}
