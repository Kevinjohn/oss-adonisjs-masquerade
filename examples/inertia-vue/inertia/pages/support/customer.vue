<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import ContextForm from '~/components/context_form.vue'
import SupportBanner from '~/components/support_banner.vue'
import { useIdentityFreshness } from './use_identity_freshness'

const props = defineProps<{
  actor: { id: number; fullName: string; email: string }
  customer: { id: number; fullName: string; email: string }
  mode: {
    isMasquerading: true
    access: 'view' | 'edit'
    contextToken: string
    targetId: string
    expiresAt: string
  }
  emailUpdates: boolean
  canEdit: boolean
}>()
const { ready } = useIdentityFreshness(props.mode, props.mode.expiresAt)
</script>

<template>
  <Head title="Customer details" />
  <main v-if="ready" class="support-page" data-identity="current">
    <h1>Customer details</h1>
    <SupportBanner :actor="actor" :customer="customer" :mode="mode" :expires-at="mode.expiresAt" />
    <section class="panel">
      <h2>{{ customer.fullName }}</h2>
      <p>Email: {{ customer.email }}</p>
      <p>
        Account-wide support access is active until
        <time :datetime="mode.expiresAt">{{ new Date(mode.expiresAt).toLocaleString() }}</time
        >.
      </p>
      <p>
        Customer email updates: <strong>{{ emailUpdates ? 'On' : 'Off' }}</strong>
      </p>
      <ContextForm v-if="canEdit" route="demo.preference" :context="mode.contextToken">
        <template #default="{ processing }">
          <label for="email-updates">Email updates</label>
          <select
            id="email-updates"
            name="emailUpdates"
            :value="emailUpdates ? '1' : '0'"
            :disabled="processing"
          >
            <option value="1">On</option>
            <option value="0">Off</option>
          </select>
          <button type="submit" :disabled="processing">Save preference</button>
        </template>
      </ContextForm>
      <p v-else role="alert">This customer cannot change preferences.</p>
      <ContextForm route="demo.sensitive" :context="mode.contextToken">
        <template #default="{ processing }"
          ><button type="submit" :disabled="processing">
            Try sensitive account action
          </button></template
        >
      </ContextForm>
      <Link href="/support">Return to operator workspace</Link>
    </section>
  </main>
  <main v-else class="support-page" data-identity-pending="true" aria-live="polite">
    <h1>Checking current support access</h1>
    <p>Customer details stay hidden until the current account mode is confirmed.</p>
  </main>
</template>
