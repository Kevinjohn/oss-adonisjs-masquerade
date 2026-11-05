import { router } from '@inertiajs/vue3'
import { onBeforeUnmount, onMounted, ref } from 'vue'

type Mode = { isMasquerading: boolean; contextToken: string; targetId?: string; expiresAt?: string }

/** Reload the raw workspace when stored status has moved on or the fixed deadline passes. */
export function useWorkspaceFreshness(mode: Mode, beforeDeadline: boolean) {
  const ready = ref(false)
  const failed = ref(false)
  // Raw status does not expire stored modes. An already-expired workspace stays available for Stop.
  let expired = mode.isMasquerading && !beforeDeadline
  let generation = 0
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function reload() {
    ready.value = false
    generation++
    controller?.abort()
    router.visit('/support', { replace: true })
  }

  function expireIfDue() {
    if (expired) return true
    if (!mode.isMasquerading || !mode.expiresAt) return false
    if (beforeDeadline && Date.now() < Date.parse(mode.expiresAt)) return false
    expired = true
    reload()
    return true
  }

  async function validate() {
    ready.value = false
    failed.value = false
    if (expireIfDue()) return
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    try {
      const response = await fetch('/support/identity', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Identity check returned ${response.status}`)
      const { mode: latest } = (await response.json()) as { mode: Mode }
      if (current !== generation || expireIfDue()) return
      if (
        latest.isMasquerading !== mode.isMasquerading ||
        latest.targetId !== mode.targetId ||
        latest.contextToken !== mode.contextToken
      ) {
        reload()
        return
      }
      ready.value = true
    } catch {
      // Raw stop stays available; the server rejects any stale control token.
      if (current === generation) failed.value = true
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void validate()
  }

  function onPageShow(event: PageTransitionEvent) {
    if (event.persisted) void validate()
  }

  onMounted(() => {
    void validate()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    if (mode.isMasquerading && beforeDeadline && mode.expiresAt) {
      const remaining = Date.parse(mode.expiresAt) - Date.now()
      timer = setTimeout(expireIfDue, Math.max(0, remaining))
    }
  })

  onBeforeUnmount(() => {
    ready.value = false
    generation++
    controller?.abort()
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pageshow', onPageShow)
  })
  return { ready, failed }
}
