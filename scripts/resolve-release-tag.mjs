/**
 * Resolve which package a release tag names.
 *
 * Releases are cut by pushing a tag of the form `<package-name>@<version>`, for
 * example `@d0nj/dsh-websearch-multi@1.0.0`. The tag is the whole instruction:
 * it says which package to publish and at which version, so a push to `main`
 * never publishes anything and a tag can never publish the wrong package.
 *
 * The script refuses a tag whose version disagrees with that package's
 * `package.json`, rather than publishing a version nobody declared, and refuses
 * a tag that is not reachable from the release branch, so a stray tag on an
 * unmerged branch cannot ship code that never landed.
 *
 * Output is a GitHub Actions matrix, written to `$GITHUB_OUTPUT` as `matrix` and
 * `has-packages`; the same JSON goes to stdout for local runs.
 *
 * Usage:
 *   node scripts/resolve-release-tag.mjs --tag '@d0nj/pkg@1.0.0'
 *   node scripts/resolve-release-tag.mjs --all          # every publishable package
 *
 * @module scripts/resolve-release-tag
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Directory holding the packages. */
const PACKAGES_DIR = 'packages'

/**
 * Parse the command line.
 * @param argv - arguments after the script name.
 * @returns the tag to resolve, or `all` for every publishable package.
 */
function parseArgs(argv) {
  let tag
  let all = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--all') all = true
    else if (arg === '--tag') {
      tag = argv[index + 1]
      index += 1
    }
  }
  if (!all && tag === undefined) {
    throw new Error("usage: resolve-release-tag.mjs --tag '<package>@<version>' | --all")
  }
  return { tag, all }
}

/**
 * Read every package manifest that could be published.
 * @returns package facts in directory order.
 */
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
      // A broken manifest is not a release candidate, but it must not be silent:
      // otherwise a typo here reads as "nothing to publish".
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

/**
 * Split `<package-name>@<version>` at its last `@`.
 *
 * A scoped name contains its own `@`, so splitting at the first one would turn
 * `@d0nj/pkg@1.0.0` into `''` and `d0nj/pkg@1.0.0`.
 * @param tag - the tag to split.
 * @returns the package name and version, or `undefined` when the tag has no version.
 */
function splitTag(tag) {
  const at = tag.lastIndexOf('@')
  if (at <= 0) return undefined
  return { name: tag.slice(0, at), version: tag.slice(at + 1) }
}

/**
 * Whether a commit is reachable from the release branch.
 *
 * A tag on a side branch names code that never merged, so publishing it would
 * ship a version whose source does not exist on the branch consumers track.
 * @param rev - commit to test.
 * @param branch - release branch name.
 * @returns true when the commit is an ancestor of (or equal to) the branch tip.
 */
function onBranch(rev, branch) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', rev, `origin/${branch}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const { tag, all } = parseArgs(process.argv.slice(2))
const packages = readPackages()
const releaseBranch = process.env.RELEASE_BRANCH ?? 'main'

let selected
if (all) {
  selected = packages
  console.error(`resolving every publishable package (${selected.length} found)`)
} else {
  const parsed = splitTag(tag)
  if (parsed === undefined) {
    throw new Error(
      `tag "${tag}" does not name a version; release tags look like @d0nj/dsh-websearch-multi@1.0.0`,
    )
  }
  const match = packages.find((entry) => entry.name === parsed.name)
  if (match === undefined) {
    const known = packages.map((entry) => entry.name).join(', ')
    throw new Error(`tag "${tag}" names no package in this repo; packages are: ${known}`)
  }
  if (match.version !== parsed.version) {
    throw new Error(
      `tag "${tag}" disagrees with ${match.dir}/package.json, which declares ${match.version}; ` +
        `bump the manifest and tag ${match.name}@${match.version}, or delete and re-push the tag`,
    )
  }
  // A tag pushed from a side branch would publish code that never merged.
  if (!onBranch('HEAD', releaseBranch)) {
    throw new Error(`tag "${tag}" is not reachable from origin/${releaseBranch}; refusing to publish unreleased code`)
  }
  selected = [match]
}

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
  // `has-packages` exists because a matrix with an empty `include` is not the
  // same as "skip": the job needs an explicit flag to gate on.
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${json}\n`)
  appendFileSync(process.env.GITHUB_OUTPUT, `has-packages=${matrix.length > 0}\n`)
}
