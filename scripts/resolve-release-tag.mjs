/**
 * Resolve which packages a release event publishes: the package a pushed tag
 * names, or every manifest version the registry does not have yet.
 *
 * Usage:
 *   node scripts/resolve-release-tag.mjs --tag '@d0nj/pkg@1.0.0'
 *   node scripts/resolve-release-tag.mjs --unpublished
 *   node scripts/resolve-release-tag.mjs --all
 *
 * @module scripts/resolve-release-tag
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGES_DIR = 'packages'
const REGISTRY = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org'

function parseArgs(argv) {
  let tag
  let all = false
  let unpublished = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--all') all = true
    else if (arg === '--unpublished') unpublished = true
    else if (arg === '--tag') {
      tag = argv[index + 1]
      index += 1
    }
  }
  if (!all && !unpublished && tag === undefined) {
    throw new Error("usage: resolve-release-tag.mjs --tag '<package>@<version>' | --unpublished | --all")
  }
  if ([all, unpublished, tag !== undefined].filter(Boolean).length > 1) {
    throw new Error('choose exactly one of --tag, --unpublished, or --all')
  }
  return { tag, all, unpublished }
}

function readPackages() {
  const dirs = readdirSync(PACKAGES_DIR).filter((entry) =>
    statSync(join(PACKAGES_DIR, entry)).isDirectory(),
  )
  const packages = []
  for (const entry of dirs) {
    const dir = `${PACKAGES_DIR}/${entry}`
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error(`${dir}/package.json is not valid JSON: ${String(error)}`)
    }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`${dir}/package.json must declare both name and version`)
    }
    packages.push({
      name: manifest.name,
      version: manifest.version,
      dir,
      publishable: manifest.private !== true,
    })
  }
  return packages.sort((left, right) => left.dir.localeCompare(right.dir))
}

function splitTag(tag) {
  const at = tag.lastIndexOf('@')
  if (at <= 0) return undefined
  return { name: tag.slice(0, at), version: tag.slice(at + 1) }
}

function onBranch(rev, branch) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', rev, `origin/${branch}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function isPublished(name, version) {
  const url = `${REGISTRY}/${name.replace('/', '%2F')}/${encodeURIComponent(version)}`
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch (error) {
    throw new Error(`cannot reach ${REGISTRY} for ${name}@${version}: ${String(error)}`)
  }
  if (response.ok) return true
  if (response.status === 404) return false
  throw new Error(`registry answered ${response.status} for ${name}@${version}`)
}

async function selectUnpublished(packages) {
  const results = await Promise.all(
    packages.map(async (entry) => ({ entry, published: await isPublished(entry.name, entry.version) })),
  )
  const selected = []
  for (const { entry, published } of results) {
    if (published) console.error(`skipping ${entry.name}@${entry.version}: already published`)
    else selected.push(entry)
  }
  return selected
}

function emitMatrix(selected) {
  const matrix = selected
    .filter((entry) => entry.publishable)
    .map((entry) => ({ name: entry.name, version: entry.version, dir: entry.dir }))

  for (const entry of selected.filter((candidate) => !candidate.publishable)) {
    console.error(`not publishing ${entry.name}: marked private`)
  }

  const result = { include: matrix }
  const json = JSON.stringify(result)
  console.log(json)

  if (process.env.GITHUB_OUTPUT !== undefined) {
    // A matrix with an empty `include` is not the same as "skip": the job needs
    // an explicit flag to gate on.
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${json}\n`)
    appendFileSync(process.env.GITHUB_OUTPUT, `has-packages=${matrix.length > 0}\n`)
  }
}

const options = parseArgs(process.argv.slice(2))
const packages = readPackages()
const releaseBranch = process.env.RELEASE_BRANCH ?? 'main'

if (options.all) {
  console.error(`resolving every publishable package (${packages.length} found)`)
  emitMatrix(packages)
} else if (options.unpublished) {
  const selected = await selectUnpublished(packages)
  console.error(`resolving unpublished versions (${selected.length} found)`)
  emitMatrix(selected)
} else {
  const parsed = splitTag(options.tag)
  if (parsed === undefined) {
    throw new Error(
      `tag "${options.tag}" does not name a version; release tags look like @d0nj/dsh-websearch-multi@1.0.0`,
    )
  }
  const match = packages.find((entry) => entry.name === parsed.name)
  if (match === undefined) {
    const known = packages.map((entry) => entry.name).join(', ')
    throw new Error(`tag "${options.tag}" names no package in this repo; packages are: ${known}`)
  }
  if (match.version !== parsed.version) {
    throw new Error(
      `tag "${options.tag}" disagrees with ${match.dir}/package.json, which declares ${match.version}; ` +
        `bump the manifest and tag ${match.name}@${match.version}, or delete and re-push the tag`,
    )
  }
  if (!onBranch('HEAD', releaseBranch)) {
    throw new Error(`tag "${options.tag}" is not reachable from origin/${releaseBranch}; refusing to publish unreleased code`)
  }
  emitMatrix([match])
}
