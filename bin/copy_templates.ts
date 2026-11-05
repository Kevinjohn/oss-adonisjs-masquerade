import { copyFileSync, globSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

for (const source of globSync('stubs/**/*.stub')) {
  const destination = join('build', source)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}
