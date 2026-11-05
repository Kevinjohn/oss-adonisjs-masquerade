import { Form, Link, usePage } from '@inertiajs/react'
import type { ReactNode } from 'react'

type Shared = { user?: { fullName: string | null; email: string } }
type Flash = { error?: string; success?: string }
export default function Layout({ children }: { children: ReactNode }) {
  const page = usePage<Shared>()
  const { user } = page.props
  const flash = page.flash as Flash
  return (
    <>
      <header>
        <nav aria-label="Main navigation">
          <Link href="/">Home</Link>
          {user ? (
            <>
              <Link href="/support">Support workspace</Link>
              <span>{user.fullName ?? user.email}</span>
              <Form action="/logout" method="post">
                <button type="submit">Log out</button>
              </Form>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Sign up</Link>
            </>
          )}
        </nav>
      </header>
      <main>
        {flash?.error && <p role="alert">{flash.error}</p>}
        {flash?.success && <p role="status">{flash.success}</p>}
        {children}
      </main>
    </>
  )
}
