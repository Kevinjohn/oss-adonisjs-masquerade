import Alpine from 'alpinejs'

Alpine.data('themeToggle', function () {
  return {
    theme: 'light',
    init() {
      this.theme = this.$el.dataset.initialTheme || 'light'
    },
    toggle() {
      const next = this.theme === 'dark' ? 'light' : 'dark'
      this.theme = next
      document.documentElement.setAttribute('data-theme', next)
      document.cookie = `app_theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    },
  }
})

Alpine.start()

for (const workspace of document.querySelectorAll('[data-masquerade-deadline]')) {
  const deadline = Date.parse(workspace.dataset.masqueradeDeadline)
  const update = () => {
    const expired = Date.now() >= deadline
    for (const element of workspace.querySelectorAll('[data-masquerade-active]'))
      element.hidden = expired
    for (const element of workspace.querySelectorAll('[data-masquerade-expired]'))
      element.hidden = !expired
  }
  update()
  const timer = window.setTimeout(update, Math.max(0, deadline - Date.now()))
  document.addEventListener('visibilitychange', update)
  window.addEventListener(
    'pagehide',
    () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', update)
    },
    { once: true }
  )
}
