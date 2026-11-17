import { router } from '@inertiajs/vue3'

const visitedKey = 'masquerade-identity-page-visited'

/** Revalidate restored identity-bearing pages through the raw workspace. */
export function installMasqueradeHistoryRecovery() {
  router.on('navigate', (event) => {
    if (/^\/(dashboard|account|settings|masquerade)(\/|$)/.test(event.detail.page.url)) {
      sessionStorage.setItem(visitedKey, 'true')
    }
  })
  const recover = () => {
    if (sessionStorage.getItem(visitedKey) !== 'true') return
    document.documentElement.dataset.identityPending = 'true'
    window.location.replace('/masquerade/accounts')
  }
  window.addEventListener('popstate', recover)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) recover()
  })
}
