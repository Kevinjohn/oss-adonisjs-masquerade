import type { ApplicationService } from '@adonisjs/core/types'
import { nativeAdapter } from '#config/masquerade'

export default class MasqueradeNativeProvider {
  constructor(private app: ApplicationService) {}

  register(): void {
    this.app.container.bindValue('masquerade.native', nativeAdapter)
  }
}
