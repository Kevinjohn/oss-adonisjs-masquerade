import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromiumInstallArgs } from './helpers/example_chromium.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const example = join(root, 'examples/inertia-react')
const noBrowser = process.argv.includes('--no-browser')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24')

function run(cwd: string, label: string, args: string[]) {
  console.log(`[inertia-react] ${label}: pnpm ${args.join(' ')}`)
  const result = spawnSync('pnpm', args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: process.env.HOST ?? '127.0.0.1',
      PORT: process.env.PORT ?? '3371',
      DB_CLIENT: 'sqlite',
      CI: 'true',
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} failed (${result.status ?? result.signal})`)
}

run(root, 'build package', ['build'])
run(root, 'pack package', ['pack:fixture'])
run(example, 'install pinned example', ['install', '--force', '--no-frozen-lockfile'])
run(example, 'lint', ['lint'])
run(example, 'typecheck', ['typecheck'])
run(example, 'build', ['build'])
run(example, 'functional tests', ['test', 'functional'])
if (!noBrowser) {
  run(example, 'install matching Chromium', chromiumInstallArgs(example))
  run(example, 'browser tests', ['test:browser'])
}
