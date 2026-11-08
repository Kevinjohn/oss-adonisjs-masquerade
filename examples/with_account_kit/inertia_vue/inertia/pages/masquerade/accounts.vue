<script setup lang="ts">
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

defineProps<{
  operatorEmail: string
  canMasquerade: boolean
  mode: Mode
  accounts: { id: number; email: string }[]
  targetEmail: string | null
  outcome: { type: 'success' | 'error'; message: string } | null
}>()
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
      <p>
        You are acting as <strong>{{ targetEmail ?? `account ${mode.targetId}` }}</strong> ({{
          mode.access === 'edit' ? 'can edit' : 'view only'
        }}) until
        <time :datetime="mode.expiresAt">{{ new Date(mode.expiresAt).toLocaleString() }}</time
        >.
      </p>
      <p><Link route="dashboard">Open their dashboard</Link></p>
      <Form route="masquerade.stop">
        <input type="hidden" name="_masqueradeContext" :value="mode.contextToken" />
        <button type="submit" class="btn btn--primary">Stop masquerade</button>
      </Form>
    </template>
    <p v-else-if="!canMasquerade">Your account is not a masquerade operator.</p>
    <p v-else-if="accounts.length === 0">There are no other accounts yet.</p>
    <ul v-else>
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
          <button type="submit" class="btn btn--primary btn--sm">Act as {{ account.email }}</button>
        </Form>
      </li>
    </ul>
  </section>
</template>
