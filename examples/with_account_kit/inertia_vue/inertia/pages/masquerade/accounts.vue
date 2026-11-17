<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/app.vue'
defineOptions({ layout: AppLayout })

type Mode =
  | { isMasquerading: false; contextToken: string }
  | {
      isMasquerading: true
      contextToken: string
      targetId: string
      access: 'view' | 'edit'
      expiresAt: string
    }

const props = defineProps<{
  operatorEmail: string
  canMasquerade: boolean
  mode: Mode
  accounts: { id: number; email: string }[]
  targetEmail: string | null
  expired: boolean
  outcome: { type: 'success' | 'error'; message: string } | null
}>()
const now = ref(Date.now())
const expired = computed(
  () =>
    props.mode.isMasquerading && (props.expired || Date.parse(props.mode.expiresAt) <= now.value)
)
let deadlineTimer: ReturnType<typeof setTimeout> | undefined
const update = () => {
  now.value = Date.now()
}
onMounted(() => {
  if (props.mode.isMasquerading)
    deadlineTimer = setTimeout(update, Math.max(0, Date.parse(props.mode.expiresAt) - Date.now()))
  document.addEventListener('visibilitychange', update)
})
onUnmounted(() => {
  if (deadlineTimer) clearTimeout(deadlineTimer)
  document.removeEventListener('visibilitychange', update)
})
</script>

<template>
  <section class="page">
    <Head title="Masquerade" />
    <header class="page__header">
      <h1 class="page__title">Masquerade</h1>
    </header>
    <p>
      Signed in as <strong>{{ operatorEmail }}</strong
      >.
    </p>
    <p v-if="outcome" :role="outcome.type === 'error' ? 'alert' : 'status'">
      {{ outcome.message }}
    </p>

    <template v-if="mode.isMasquerading">
      <template v-if="expired">
        <p role="status">The persisted masquerade mode has expired. Refresh status or stop it.</p>
        <p><Link route="masquerade.accounts">Refresh status</Link></p>
      </template>
      <template v-else>
        <p>
          You are acting as <strong>{{ targetEmail ?? `account ${mode.targetId}` }}</strong> ({{
            mode.access === 'edit' ? 'can edit' : 'view only'
          }}) until
          <time :datetime="mode.expiresAt">{{ new Date(mode.expiresAt).toLocaleString() }}</time
          >.
        </p>
        <p><Link route="dashboard">Open their dashboard</Link></p>
      </template>
      <Form route="masquerade.stop">
        <input type="hidden" name="_masqueradeContext" :value="mode.contextToken" />
        <button type="submit" class="btn btn--primary">Stop masquerade</button>
      </Form>
    </template>
    <p v-else-if="!canMasquerade">Your account is not a masquerade operator.</p>
    <p v-else-if="accounts.length === 0">There are no other accounts yet.</p>
    <template v-else>
      <p>Showing up to 50 accounts, ordered by email.</p>
      <ul>
        <li v-for="account in accounts" :key="account.id">
          <Form route="masquerade.start">
            <input type="hidden" name="_masqueradeContext" :value="mode.contextToken" />
            <input type="hidden" name="targetId" :value="account.id" />
            <span>{{ account.email }}</span>
            {{ ' ' }}
            <label>
              Access
              <select name="access">
                <option value="view" selected>View only</option>
                <option value="edit">Can edit</option>
              </select>
            </label>
            {{ ' ' }}
            <button type="submit" class="btn btn--primary btn--sm">
              Act as {{ account.email }}
            </button>
          </Form>
        </li>
      </ul>
    </template>
  </section>
</template>
