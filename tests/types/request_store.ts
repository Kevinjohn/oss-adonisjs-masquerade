import { defineConfig } from '../../src/define_config.js'
import type { ControlStore, MasqueradeConfig, RequestControlStore } from '../../src/types.js'

declare const full: MasqueradeConfig<unknown, object>
declare const requestOnly: MasqueradeConfig<unknown, object, RequestControlStore>

const fullStore = defineConfig(full).store()
fullStore.then((store: ControlStore) => store.activeBatch({ limit: 1 }))
defineConfig<unknown, object>(full)
  .store()
  .then((store) => store.activeBatch({ limit: 1 }))

const narrowStore = defineConfig(requestOnly).store()
narrowStore.then((store) => store.read({ namespace: 'test', actorId: 'a', actorIncarnation: 'a' }))
// @ts-expect-error A request-only store does not promise operator housekeeping.
narrowStore.then((store) => store.activeBatch({ limit: 1 }))
