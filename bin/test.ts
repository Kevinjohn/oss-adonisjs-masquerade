import { assert } from '@japa/assert'
import { expectTypeOf } from '@japa/expect-type'
import { fileSystem } from '@japa/file-system'
import { configure, processCLIArgs, run } from '@japa/runner'

processCLIArgs(process.argv.splice(2))

configure({
  files: ['tests/**/*.spec.ts'],
  // V8 coverage instrumentation slows the setup specs past Japa's 2s default.
  timeout: process.env.NODE_V8_COVERAGE ? 10_000 : undefined,
  plugins: [assert(), expectTypeOf(), fileSystem()],
  // Japa exits 0 when its filters select nothing; a gate that ran no tests checked nothing.
  teardown: [
    (runner) => {
      if (runner.getSummary().aggregates.total > 0) return
      console.error('No tests executed: check the --files, --tests and --groups filters')
      process.exitCode = 1
    },
  ],
})

run()
