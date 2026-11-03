import { spawnSync } from 'node:child_process'
import { test } from '@japa/runner'

function ignored(path: string): boolean {
  return spawnSync('git', ['check-ignore', '--quiet', '--no-index', path]).status === 0
}

test('keeps local review documents and generated API pages out of commits', ({ assert }) => {
  for (const path of [
    'docs/reviews/account_kit_inspection_review.md',
    'docs/maintainers/reviews/review.md',
    'docs/api/index.html',
    'docs/reference/api/index.md',
  ]) {
    assert.isTrue(ignored(path), path)
  }
})
