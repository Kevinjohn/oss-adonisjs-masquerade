import './css/app.css'
import { createRoot } from 'react-dom/client'
import { createInertiaApp, type ResolvedComponent } from '@inertiajs/react'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'
import Layout from '~/layouts/default'
import type { ReactNode } from 'react'
import { installSupportHistoryRecovery } from './support_history'

installSupportHistoryRecovery()

createInertiaApp({
  title: (title) => (title ? `${title} — Support example` : 'Support example'),
  resolve: async (name) => {
    const page = await resolvePageComponent(
      `./pages/${name}.tsx`,
      import.meta.glob<{ default: ResolvedComponent }>('./pages/**/*.tsx'),
      (page: ReactNode) => <Layout>{page}</Layout>
    )
    return page.default
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />)
  },
  progress: { color: '#173b62' },
})
