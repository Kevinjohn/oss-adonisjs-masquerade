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
  let timer
  const update = () => {
    const expired = Date.now() >= deadline
    for (const element of workspace.querySelectorAll('[data-masquerade-active]'))
      if (element.hidden !== expired) element.hidden = expired
    for (const element of workspace.querySelectorAll('[data-masquerade-expired]'))
      if (element.hidden !== !expired) element.hidden = !expired
    window.clearTimeout(timer)
    if (!expired) timer = window.setTimeout(update, deadline - Date.now())
  }
  update()
  document.addEventListener('visibilitychange', update)
  window.addEventListener('pageshow', update)
  window.addEventListener('pagehide', () => window.clearTimeout(timer))
}
