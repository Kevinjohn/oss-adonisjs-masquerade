<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import type { routes } from '@generated/registry'

type RouteName = keyof typeof routes

const props = defineProps<{
  route: RouteName
  context: string
  method?: 'post'
}>()

// Keep the control bound to its rendered token; the server rejects it if that context is stale.
const originalContext = props.context
</script>

<template>
  <Form v-slot="{ processing }" :route="route" :method="method ?? 'post'">
    <input type="hidden" name="_masqueradeContext" :value="originalContext" />
    <slot :processing="processing" />
  </Form>
</template>
