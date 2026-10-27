import { test } from '@japa/runner'
import { CodeTransformer } from '@adonisjs/assembler/code_transformer'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as prettier from 'prettier'
import { wireAuthGuards, wireContextMiddleware, wireStatusMiddleware } from '../configure_wiring.js'
import { starterAuthConfig, starterKernel } from './helpers/starter_kit.js'

async function host(files: { auth?: string; kernel?: string }) {
  const root = await mkdtemp(join(tmpdir(), 'masquerade-wiring-'))
  await mkdir(join(root, 'config'))
  await mkdir(join(root, 'start'))
  await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n')
  if (files.auth) await writeFile(join(root, 'config/auth.ts'), files.auth)
  if (files.kernel) await writeFile(join(root, 'start/kernel.ts'), files.kernel)
  return {
    root,
    auth: join(root, 'config/auth.ts'),
    kernel: join(root, 'start/kernel.ts'),
    project: () => new CodeTransformer(pathToFileURL(root + '/')).project,
  }
}

const contextEntry = "  () => import('#middleware/masquerade_context_middleware'),"

test.group('configure wiring', (group) => {
  // Each case loads a ts-morph project, which takes several seconds on CI runners.
  group.each.timeout(30_000)

  test('rewires the starter-kit auth config and kernel once', async ({ assert }) => {
    const h = await host({ auth: starterAuthConfig, kernel: starterKernel })
    try {
      assert.equal(await wireAuthGuards(h.project(), h.auth, 'web'), 'wired')
      assert.equal(await wireContextMiddleware(h.project(), h.kernel), 'wired')
      const auth = await readFile(h.auth, 'utf8')
      assert.include(auth, "import { sessionGuard } from '@adonisjs/auth/session'")
      assert.include(auth, "import { effectiveSessionGuard } from 'adonisjs-masquerade/auth'")
      assert.include(auth, "import { userProvider } from '#services/masquerade_user_provider'")
      assert.match(auth, /const webGuard = sessionGuard\(\{[\s\S]*provider: userProvider,\n\}\)/)
      assert.include(auth, "default: 'web_effective',")
      assert.include(
        auth,
        '    web: webGuard,\n    web_effective: effectiveSessionGuard(webGuard),\n  },'
      )
      assert.notInclude(auth, 'sessionUserProvider')
      assert.include(auth, 'InferAuthenticators<typeof authConfig> {}')
      const kernel = await readFile(h.kernel, 'utf8')
      assert.include(
        kernel,
        [
          "  () => import('@adonisjs/auth/initialize_auth_middleware'),",
          contextEntry,
          "  () => import('#middleware/silent_auth_middleware'),",
        ].join('\n')
      )

      // The repository uses the same @adonisjs/prettier-config as the starter kit.
      const prettierConfig = await prettier.resolveConfig(join(process.cwd(), 'configure.ts'))
      for (const [source, filepath] of [
        [auth, h.auth],
        [kernel, h.kernel],
      ])
        assert.isTrue(
          await prettier.check(source, { ...prettierConfig, filepath }),
          `${filepath} should match the starter's Prettier config`
        )

      assert.equal(await wireAuthGuards(h.project(), h.auth, 'web'), 'already')
      assert.equal(await wireContextMiddleware(h.project(), h.kernel), 'already')
      assert.equal(await readFile(h.auth, 'utf8'), auth)
      assert.equal(await readFile(h.kernel, 'utf8'), kernel)
    } finally {
      await rm(h.root, { recursive: true, force: true })
    }
  })

  test('leaves auth configs that do not match the starter shape unchanged', async ({ assert }) => {
    const variants = [
      starterAuthConfig.replace("default: 'web'", "default: 'api'"),
      starterAuthConfig.replace("import('#models/user')", "import('#models/account')"),
      starterAuthConfig.replace(
        "model: () => import('#models/user'),",
        "model: () => import('#models/user'),\n        passwordColumnName: 'secret',"
      ),
      starterAuthConfig.replace('web: sessionGuard({', 'web: tokensGuard({'),
      starterAuthConfig.replace('const authConfig', 'const config'),
      starterAuthConfig.replace('  guards: {', '  guards: {\n    web_effective: customGuard,'),
    ]
    for (const variant of variants) {
      const h = await host({ auth: variant })
      try {
        assert.equal(await wireAuthGuards(h.project(), h.auth, 'web'), 'skipped')
        assert.equal(await readFile(h.auth, 'utf8'), variant)
      } finally {
        await rm(h.root, { recursive: true, force: true })
      }
    }
    const missing = await host({})
    try {
      assert.equal(await wireAuthGuards(missing.project(), missing.auth, 'web'), 'skipped')
      assert.equal(await wireContextMiddleware(missing.project(), missing.kernel), 'skipped')
    } finally {
      await rm(missing.root, { recursive: true, force: true })
    }
  })

  test('only inserts the context middleware right after initialize_auth', async ({ assert }) => {
    const silentFirst = starterKernel.replace(
      "  () => import('@adonisjs/auth/initialize_auth_middleware'),\n  () => import('#middleware/silent_auth_middleware'),",
      "  () => import('#middleware/silent_auth_middleware'),\n  () => import('@adonisjs/auth/initialize_auth_middleware'),"
    )
    const noAuth = starterKernel.replace(
      "  () => import('@adonisjs/auth/initialize_auth_middleware'),\n",
      ''
    )
    for (const variant of [silentFirst, noAuth]) {
      assert.notEqual(variant, starterKernel)
      const h = await host({ kernel: variant })
      try {
        assert.equal(await wireContextMiddleware(h.project(), h.kernel), 'skipped')
        assert.equal(await readFile(h.kernel, 'utf8'), variant)
      } finally {
        await rm(h.root, { recursive: true, force: true })
      }
    }

    const withoutSilent = starterKernel.replace(
      "  () => import('#middleware/silent_auth_middleware'),\n",
      ''
    )
    const h = await host({ kernel: withoutSilent })
    try {
      assert.equal(await wireContextMiddleware(h.project(), h.kernel), 'wired')
      assert.include(
        await readFile(h.kernel, 'utf8'),
        `  () => import('@adonisjs/auth/initialize_auth_middleware'),\n${contextEntry}\n])`
      )
    } finally {
      await rm(h.root, { recursive: true, force: true })
    }
  })

  test('inserts opt-in status sharing after silent auth without duplicating it', async ({
    assert,
  }) => {
    const h = await host({ kernel: starterKernel })
    try {
      assert.equal(await wireContextMiddleware(h.project(), h.kernel), 'wired')
      assert.equal(await wireStatusMiddleware(h.project(), h.kernel), 'wired')
      const kernel = await readFile(h.kernel, 'utf8')
      assert.include(
        kernel,
        [
          "  () => import('#middleware/masquerade_context_middleware'),",
          "  () => import('#middleware/silent_auth_middleware'),",
          "  () => import('#middleware/share_masquerade_status_middleware'),",
        ].join('\n')
      )
      assert.equal(await wireStatusMiddleware(h.project(), h.kernel), 'already')
      assert.equal(await readFile(h.kernel, 'utf8'), kernel)
    } finally {
      await rm(h.root, { recursive: true, force: true })
    }
  })
})
