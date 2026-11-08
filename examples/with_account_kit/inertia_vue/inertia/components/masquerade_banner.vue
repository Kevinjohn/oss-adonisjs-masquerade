<script setup lang="ts">
import { computed } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import { usePage } from '@inertiajs/vue3'

type MasqueradeStatus =
  | { isMasquerading: false; contextToken: string }
  | {
      isMasquerading: true
      contextToken: string
      targetId: string
      access: 'view' | 'edit'
      expiresAt: string
    }

/**
 * Shown on every page while the signed-in operator acts as another account. The status comes
 * from `ShareMasqueradeStatusMiddleware`, which shares it only on effective-guard pages.
 */
const page = usePage()
const masquerade = computed(() => (page.props as { masquerade?: MasqueradeStatus }).masquerade)
</script>

<template>
  <aside
    v-if="masquerade?.isMasquerading"
    class="masquerade-banner"
    role="status"
    aria-live="polite"
  >
    <p>You are viewing as account {{ masquerade.targetId }}.</p>
    <p>Access: {{ masquerade.access === 'edit' ? 'Can edit' : 'View only' }}.</p>
    <p>
      Fixed deadline:
      <time :datetime="masquerade.expiresAt">{{
        new Date(masquerade.expiresAt).toLocaleString()
      }}</time>
    </p>
    <Form route="masquerade.stop">
      <input type="hidden" name="_masqueradeContext" :value="masquerade.contextToken" />
      <button type="submit" class="btn btn--secondary btn--sm">Stop masquerade</button>
    </Form>
  </aside>
</template>
