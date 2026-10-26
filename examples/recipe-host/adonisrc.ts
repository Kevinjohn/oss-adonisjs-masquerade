import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonisjs/session/commands'),
  ],
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/edge_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    () => import('@adonisjs/session/session_provider'),
    () => import('@adonisjs/shield/shield_provider'),
    () => import('@adonisjs/limiter/limiter_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/auth/auth_provider'),
  ],
  preloads: [() => import('#start/routes'), () => import('#start/kernel')],
  tests: {
    suites: [{ files: ['tests/functional/**/*.spec.ts'], name: 'functional', timeout: 30000 }],
    forceExit: false,
  },
})
