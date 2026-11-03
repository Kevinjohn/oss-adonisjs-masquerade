import { defineConfig } from 'vitepress'
import { githubLinks, repository } from './github_links.mts'
import { nav, sidebar } from './navigation.mts'

export default defineConfig({
  title: 'Masquerade for AdonisJS',
  description: 'Support impersonation for AdonisJS applications',
  base: '/oss-adonisjs-masquerade/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['maintainers/**'],
  rewrites: { 'README.md': 'index.md', 'reference/README.md': 'reference/index.md' },
  markdown: { config: githubLinks },
  transformPageData(pageData) {
    if (pageData.relativePath.startsWith('reference/api/')) {
      pageData.frontmatter.editLink = false
    }
  },
  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repository }],
    editLink: { pattern: `${repository}/edit/main/docs/:path` },
    nav,
    sidebar,
  },
})
