import { test } from '@japa/runner'
import { defineConfig } from '../index.ts'
import type { ControlStore, MasqueradeConfigOptions, RequestControlStore } from '../src/types.ts'

function fullConfig(options: MasqueradeConfigOptions<unknown, object>) {
  return defineConfig(options)
}

function narrowConfig(options: MasqueradeConfigOptions<unknown, object, RequestControlStore>) {
  return defineConfig(options)
}

test('defineConfig preserves full and request-only store types through resolution', ({
  expectTypeOf,
}) => {
  type FullStore = Awaited<ReturnType<ReturnType<typeof fullConfig>['resolver']>>['store']
  type NarrowStore = Awaited<ReturnType<ReturnType<typeof narrowConfig>['resolver']>>['store']
  expectTypeOf<FullStore>().returns.toEqualTypeOf<Promise<ControlStore>>()
  expectTypeOf<NarrowStore>().returns.toEqualTypeOf<Promise<RequestControlStore>>()
  expectTypeOf<NarrowStore>().returns.not.toExtend<Promise<ControlStore>>()
})
