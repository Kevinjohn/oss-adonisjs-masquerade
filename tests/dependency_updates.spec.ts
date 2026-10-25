import { test } from '@japa/runner'
import {
  actionUpdate,
  githubReleases,
  issueFor,
  planIssues,
  updateLevel,
  type DependencyUpdate,
} from '../bin/helpers/dependency_updates.js'

const npm = (name: string, current: string, latest: string): DependencyUpdate => ({
  name,
  ecosystem: 'npm',
  current,
  latest,
})

test('classifies updates, treating a 0.x minor as major', ({ assert }) => {
  assert.equal(updateLevel('5.9.3', '5.9.4'), 'patch')
  assert.equal(updateLevel('5.9.3', '5.10.0'), 'minor')
  assert.equal(updateLevel('5.9.3', '7.0.2'), 'major')
  assert.equal(updateLevel('0.21.10', '0.23.1'), 'major')
  assert.equal(updateLevel('0.21.10', '0.21.11'), 'patch')
  assert.isUndefined(updateLevel('5.9.3', '5.9.3'))
  assert.isUndefined(updateLevel('5.9.3', '4.0.0'))
})

test('opens issues for minor and major updates only, with a reason', ({ assert }) => {
  assert.isUndefined(issueFor(npm('eslint', '9.1.0', '9.1.1')))

  const minor = issueFor(npm('@adonisjs/core', '7.1.0', '7.2.0'))!
  assert.equal(minor.title, 'Update @adonisjs/core from 7.1.0 to 7.2.0')
  assert.include(minor.body, 'AdonisJS released a new minor')

  assert.include(issueFor(npm('prettier', '3.1.0', '3.2.0'))!.body, 'third-party minor')
  assert.include(issueFor(npm('typescript', '5.9.3', '7.0.2'))!.body, 'can break the API')
  assert.include(issueFor(npm('tsdown', '0.21.10', '0.23.1'))!.body, '`0.x` minor')
})

test('creates one issue per dependency and edits it when a newer version appears', ({ assert }) => {
  const first = npm('c8', '11.0.0', '12.0.0')
  assert.deepEqual(
    planIssues([first], []).map((action) => action.kind),
    ['create']
  )

  const existing = { number: 7, ...issueFor(first)! }
  assert.deepEqual(planIssues([first], [existing]), [])

  const newer = planIssues([npm('c8', '11.0.0', '13.0.0')], [existing])
  assert.deepEqual(
    newer.map((action) => action.kind === 'edit' && action.number),
    [7]
  )
})

test('ignores action minors behind a major-tag pin', ({ assert }) => {
  assert.isUndefined(actionUpdate('actions/checkout', 'v7', 'v7.2.0'))
  assert.equal(actionUpdate('actions/checkout', 'v6', 'v7.0.2')?.current, 'v6')
  assert.equal(
    actionUpdate('ossf/scorecard-action', 'v2.5.0', 'v2.6.0')?.releaseNotes,
    'https://github.com/ossf/scorecard-action/releases/tag/v2.6.0'
  )
})

test('derives a GitHub releases link from an npm repository URL', ({ assert }) => {
  assert.equal(
    githubReleases('git+https://github.com/vinejs/vine.git'),
    'https://github.com/vinejs/vine/releases'
  )
  assert.isUndefined(githubReleases('https://gitlab.com/a/b.git'))
  assert.isUndefined(githubReleases(undefined))
})
