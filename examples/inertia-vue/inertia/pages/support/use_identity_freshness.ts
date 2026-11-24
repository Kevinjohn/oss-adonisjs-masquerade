import { router } from '@inertiajs/vue3'
import { onBeforeUnmount, onMounted, ref } from 'vue'

type Mode = { isMasquerading: boolean; targetId: string; contextToken: string }

export function useIdentityFreshness(mode: Mode, expiresAt: string) {
  const ready = ref(false)
  let generation = 0
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false

  function expireIfDue() {
    if (expired || Date.now() < Date.parse(expiresAt)) return expired
    expired = true
    generation++
    controller?.abort()
    ready.value = false
    router.visit('/support', { replace: true })
    return true
  }

  async function refreshIdentity() {
    if (expireIfDue()) return
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    ready.value = false
    try {
      const response = await fetch('/support/identity', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('Unable to check the current support identity')
      const { mode: latest } = (await response.json()) as { mode: Mode }
      if (current !== generation) return
      if (expireIfDue()) return
      if (
        !latest.isMasquerading ||
        latest.targetId !== mode.targetId ||
        latest.contextToken !== mode.contextToken
      ) {
        router.visit('/support', { replace: true })
        return
      }
      ready.value = true
    } catch {
      if (current === generation) router.visit('/support/recovery', { replace: true })
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void refreshIdentity()
  }

  onMounted(() => {
    void refreshIdentity()
    document.addEventListener('visibilitychange', onVisibilityChange)
    const remaining = Date.parse(expiresAt) - Date.now()
    timer = setTimeout(expireIfDue, Math.max(0, remaining))
  })

  onBeforeUnmount(() => {
    generation++
    controller?.abort()
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { ready }
}
