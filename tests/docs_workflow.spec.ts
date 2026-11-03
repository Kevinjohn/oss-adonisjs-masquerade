import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'

const workflow = readFileSync(join(import.meta.dirname, '../.github/workflows/docs.yml'), 'utf8')

test('pull request docs builds do not share the Pages deployment concurrency group', ({
  assert,
}) => {
  const group = workflow.match(/^concurrency:\n(?:\s+#.*\n)*\s+group: (.+)$/m)?.[1]
  // The same expression as Account Kit's docs workflow: one queue per PR, deployments share 'pages'.
  assert.equal(
    group,
    "${{ github.event_name == 'pull_request' && format('pages-pr-{0}', github.event.pull_request.number) || 'pages' }}"
  )
})
