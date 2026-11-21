import { Form, usePage } from '@inertiajs/react'

export default function Login() {
  const { errors } = usePage<{ errors: Record<string, string> }>().props
  return (
    <section className="support-page">
      <h1>Sign in</h1>
      <Form action="/login" method="post">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          required
        />
        {errors.email && (
          <p id="email-error" role="alert">
            {errors.email}
          </p>
        )}
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'password-error' : undefined}
          required
        />
        {errors.password && (
          <p id="password-error" role="alert">
            {errors.password}
          </p>
        )}
        <button type="submit">Sign in</button>
      </Form>
    </section>
  )
}
