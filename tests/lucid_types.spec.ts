import { test } from '@japa/runner'
import type {
  LucidControlClient,
  LucidControlStoreOptions,
} from '@kevinjohn/adonisjs-masquerade/types/lucid'
import type { LucidControlStore } from '../src/stores/lucid.ts'

test('Lucid types are exposed by the optional integration rather than the core', ({
  expectTypeOf,
}) => {
  expectTypeOf<
    ConstructorParameters<typeof LucidControlStore>[0]
  >().toEqualTypeOf<LucidControlClient>()
  expectTypeOf<
    Exclude<ConstructorParameters<typeof LucidControlStore>[1], undefined>
  >().toEqualTypeOf<LucidControlStoreOptions>()
  const compileCases = () => {
    // @ts-expect-error Optional Lucid types belong to types/lucid, outside the core types entry.
    type CoreClient = import('@kevinjohn/adonisjs-masquerade/types').LucidControlClient
    const client = null as unknown as CoreClient
    void client
  }
  expectTypeOf(compileCases).toBeFunction()
})
