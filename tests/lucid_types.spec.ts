import { test } from '@japa/runner'
import type {
  LucidControlClient,
  LucidControlStoreOptions,
} from '@kevinjohn/adonisjs-masquerade/types/lucid'
import type {
  LucidControlStore,
  LucidControlClient as FeatureClient,
  LucidControlStoreOptions as FeatureOptions,
} from '@kevinjohn/adonisjs-masquerade/stores/lucid'

test('Lucid types are exposed by the optional integration rather than the core', ({
  expectTypeOf,
}) => {
  expectTypeOf<FeatureClient>().toEqualTypeOf<LucidControlClient>()
  expectTypeOf<FeatureOptions>().toEqualTypeOf<LucidControlStoreOptions>()
  expectTypeOf<
    ConstructorParameters<typeof LucidControlStore>[0]
  >().toEqualTypeOf<LucidControlClient>()
  expectTypeOf<
    Exclude<ConstructorParameters<typeof LucidControlStore>[1], undefined>
  >().toEqualTypeOf<LucidControlStoreOptions>()
  const compileCases = () => {
    // @ts-expect-error Optional Lucid types belong to types/lucid, outside the core types entry.
    type CoreClient = import('@kevinjohn/adonisjs-masquerade/types').LucidControlClient
    // @ts-expect-error Optional store options also stay outside the core types entry.
    type CoreOptions = import('@kevinjohn/adonisjs-masquerade/types').LucidControlStoreOptions
    const client = null as unknown as CoreClient
    const options = null as unknown as CoreOptions
    void [client, options]
  }
  expectTypeOf(compileCases).toBeFunction()
})
