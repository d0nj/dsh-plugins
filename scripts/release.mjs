import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const resolve = createRequire(import.meta.url)
const semanticReleaseBin = join(dirname(resolve.resolve('semantic-release')), 'bin', 'semantic-release.js')
const forwarded = process.argv.slice(2)

const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, 'packages', entry.name))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .filter(({ manifest }) => manifest.private !== true)

const failures = []

for (const { dir, manifest } of packages) {
  console.log(`\n=== ${manifest.name} ===`)
  const result = spawnSync(
    process.execPath,
    [
      semanticReleaseBin,
      '--extends', 'semantic-release-monorepo',
      '--branches', 'main',
      '--tag-format', `${manifest.name}@\${version}`,
      ...forwarded,
    ],
    { cwd: dir, stdio: 'inherit', env: process.env },
  )
  if (result.status !== 0) failures.push(manifest.name)
}

if (failures.length > 0) {
  console.error(`\nRelease failed for: ${failures.join(', ')}`)
  process.exit(1)
}
