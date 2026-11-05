import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Use the browser client's installed peer, including pnpm's isolated peer layout. */
export function chromiumInstallArgs(example: string) {
  const require = createRequire(join(example, 'package.json'))
  const manifest = require.resolve('playwright/package.json', {
    paths: [require.resolve('@japa/browser-client')],
  })
  return [
    'exec',
    'node',
    join(dirname(manifest), 'cli.js'),
    'install',
    ...(process.platform === 'linux' ? ['--with-deps'] : []),
    'chromium',
  ]
}
