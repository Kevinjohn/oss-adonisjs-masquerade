async function csrfToken() {
  const response = await fetch('/kit/auth/csrf', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Could not start the request. Please retry.')
  const body = await response.json()
  return body.token ?? body.csrfToken
}

async function managedRequest(path, method, body) {
  const token = await csrfToken()
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': token,
      'accept': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}))
  return { response, issue: data.errors?.[0] ?? data }
}

function showError(form, message) {
  const alert = form.querySelector('[data-kit-error]')
  alert.textContent = message
  alert.hidden = false
}

function enable(form) {
  const button = form.querySelector('button[type=submit]')
  button.disabled = false
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    button.disabled = true
    const alert = form.querySelector('[data-kit-error]')
    alert.hidden = true
    if (form.matches('[data-kit-profile]')) form.querySelector('[data-kit-stop]').hidden = true
    try {
      if (form.matches('[data-kit-login]')) {
        const { response, issue } = await managedRequest('/kit/auth/login', 'POST', {
          email: form.elements.email.value,
          password: form.elements.password.value,
        })
        if (!response.ok)
          throw new Error(
            issue.message ?? issue.title ?? 'Sign in failed. Check your credentials and retry.'
          )
        window.location.assign('/support')
      } else if (form.matches('[data-kit-profile]')) {
        const { response, issue } = await managedRequest('/kit/account/profile', 'PATCH', {
          currentPassword: form.elements.currentPassword.value,
          registrationData: { fullName: form.elements.fullName.value },
        })
        if (!response.ok) {
          form.querySelector('[data-kit-stop]').hidden =
            issue.code !== 'E_MASQUERADE_SENSITIVE_ACTION_BLOCKED'
          throw new Error(
            issue.message ?? issue.title ?? 'The display name could not be saved. Please retry.'
          )
        }
        window.location.reload()
      } else {
        const { response, issue } = await managedRequest('/kit/account/logout', 'POST')
        if (!response.ok)
          throw new Error(issue.message ?? issue.title ?? 'Sign out failed. Please retry.')
        window.location.assign('/login')
      }
    } catch (error) {
      if (form.elements.password) form.elements.password.value = ''
      if (form.elements.currentPassword) form.elements.currentPassword.value = ''
      showError(form, error.message || 'The request failed. Please retry.')
      button.disabled = false
    }
  })
}

document.querySelectorAll('[data-kit-login], [data-kit-profile], [data-kit-logout]').forEach(enable)
