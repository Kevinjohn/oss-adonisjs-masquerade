<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import { Form } from '@adonisjs/inertia/vue'
import { Link } from '@adonisjs/inertia/vue'
import SupportBanner from '~/components/support_banner.vue'
import ContextForm from '~/components/context_form.vue'
import { useWorkspaceFreshness } from './use_workspace_freshness'

type UserLabel = { id: number; fullName: string; email: string }
type Mode =
  | { isMasquerading: false; contextToken: string }
  | {
      isMasquerading: true
      access: 'view' | 'edit'
      contextToken: string
      targetId: string
      expiresAt: string
    }
const props = defineProps<{
  actor: UserLabel
  operator: boolean
  mode: Mode
  customers: UserLabel[]
  target: UserLabel | null
  beforeDeadline: boolean
  targetAvailable: boolean
}>()
const { ready } = useWorkspaceFreshness(props.mode, props.beforeDeadline)
</script>

<template>
  <Head title="Support workspace" />
  <main class="support-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Account support</p>
        <h1>Support workspace</h1>
      </div>
      <Form route="session.destroy"><button type="submit">Log out</button></Form>
    </header>
    <p>
      Signed in as <strong>{{ actor.fullName }}</strong> ({{ actor.email }}).
    </p>

    <SupportBanner
      v-if="ready && mode.isMasquerading && target && beforeDeadline"
      :actor="actor"
      :customer="target"
      :mode="mode"
      :expires-at="mode.expiresAt!"
    />
    <section v-if="mode.isMasquerading" class="panel">
      <h2>Current support session</h2>
      <p v-if="!ready" data-workspace-identity-pending role="status">
        Checking current support access. Customer details stay hidden until the current account mode
        is confirmed.
      </p>
      <p v-else-if="targetAvailable && target && beforeDeadline" data-workspace-identity="current">
        Viewing {{ target.fullName }} ({{ target.email }}).
      </p>
      <p v-else role="alert">
        The customer is no longer available. Customer pages are blocked. You can stop support mode
        here.
      </p>
      <p v-if="mode.expiresAt">
        Fixed deadline:
        <time :datetime="mode.expiresAt">{{ new Date(mode.expiresAt).toLocaleString() }}</time>
      </p>
      <ContextForm route="demo.stop" :context="mode.contextToken" submit-label="Stop support mode">
        <template #default="{ processing }"
          ><button type="submit" :disabled="processing">Stop support mode</button></template
        >
      </ContextForm>
      <Link v-if="ready && targetAvailable && beforeDeadline" href="/support/customer"
        >Open customer details</Link
      >
    </section>

    <section v-else class="panel">
      <h2>Start support mode</h2>
      <p v-if="!operator" role="alert">This account cannot start support mode.</p>
      <ContextForm
        route="demo.start"
        :context="mode.contextToken"
        submit-label="Start support mode"
      >
        <template #default="{ processing }">
          <label for="customer">Customer</label>
          <select id="customer" name="targetId" required :disabled="!operator || processing">
            <option value="" disabled selected>Choose an eligible customer</option>
            <option v-for="customer in customers" :key="customer.id" :value="customer.id">
              {{ customer.fullName }} — {{ customer.email }}
            </option>
          </select>
          <label for="reason">Reason for support</label>
          <textarea
            id="reason"
            name="reason"
            required
            minlength="1"
            maxlength="500"
            :disabled="!operator || processing"
          />
          <fieldset :disabled="!operator || processing">
            <legend>Access level</legend>
            <label>
              <input type="radio" name="access" value="view" checked />
              View only
            </label>
            <label>
              <input type="radio" name="access" value="edit" />
              Can edit
            </label>
          </fieldset>
          <button type="submit" :disabled="!operator || processing">Start support mode</button>
        </template>
      </ContextForm>
    </section>
    <p v-if="!ready"><Link href="/support">Check current status</Link></p>
    <p><Link href="/">Home</Link></p>
  </main>
</template>
