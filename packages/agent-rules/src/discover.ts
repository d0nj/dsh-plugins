/**
 * Project-root discovery and the ancestor chain for repo instruction files.
 *
 * This mirrors the discovery the shipped `@deepseek-ai/dsh-agent-instructions`
 * row performs, so replacing it changes where rules land in the prompt without
 * changing which files are considered.
 *
 * Discovery is upward from the session cwd to the first directory holding a
 * root marker, then downward again to the cwd. Every directory in that chain
 * contributes its own `AGENTS.md`, which is how a package keeps guidelines for
 * its subtree while the repository keeps shared ones.
 *
 * @module @d0nj/dsh-agent-rules/discover
 */
import { statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Child names that mark a project root, matching the shipped default. */
const DEFAULT_PROJECT_ROOT_MARKERS = ['.git']

/** Instruction file names per directory, in rendering order. */
const DEFAULT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md']

/** Instruction overlay names per directory, rendered after the base file. */
const DEFAULT_LOCAL_INSTRUCTION_FILES = ['AGENTS.local.md', 'CLAUDE.local.md']

/** Discovery controls resolved from row configuration. */
export interface DiscoveryConfig {
  readonly projectRootMarkers: readonly string[]
  readonly instructionFileCandidates: readonly string[]
  readonly localInstructionFileCandidates: readonly string[]
}

/** One discovered instruction file, ready to read. */
export interface InstructionFile {
  readonly absolutePath: string
  readonly displayPath: string
}

/**
 * Fill unspecified discovery controls with the shipped defaults.
 * @param config - partial row configuration.
 * @returns complete discovery controls.
 */
export function resolveDiscoveryConfig(config: {
  projectRootMarkers?: readonly string[] | undefined
  instructionFileCandidates?: readonly string[] | undefined
  localInstructionFileCandidates?: readonly string[] | undefined
}): DiscoveryConfig {
  return {
    projectRootMarkers: config.projectRootMarkers ?? DEFAULT_PROJECT_ROOT_MARKERS,
    instructionFileCandidates: config.instructionFileCandidates ?? DEFAULT_INSTRUCTION_FILES,
    localInstructionFileCandidates: config.localInstructionFileCandidates ?? DEFAULT_LOCAL_INSTRUCTION_FILES,
  }
}

/**
 * Walk upward to the first directory containing a root marker.
 * @param cwd - absolute session working directory.
 * @param markers - child names that identify a project root.
 * @returns the discovered root, or `cwd` when no marker exists.
 */
export function findProjectRoot(cwd: string, markers: readonly string[]): string {
  const start = resolve(cwd)
  let current = start
  for (;;) {
    for (const marker of markers) {
      if (exists(join(current, marker))) return current
    }
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/**
 * Build the inclusive root-to-cwd directory chain.
 * @param root - project root.
 * @param cwd - most-specific directory.
 * @returns directories ordered from broadest to most specific.
 */
export function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = []
  const resolvedRoot = resolve(root)
  let current = resolve(cwd)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * Discover every instruction file from the project root down to the cwd.
 *
 * The project-relative display path is what the model sees, so a nested file
 * reads as `packages/foo/AGENTS.md` rather than as a machine path.
 * @param cwd - absolute session working directory.
 * @param config - resolved discovery controls.
 * @returns existing instruction files in rendering order.
 */
export function discoverInstructionFiles(cwd: string, config: DiscoveryConfig): InstructionFile[] {
  const start = resolve(cwd)
  const projectRoot = findProjectRoot(start, config.projectRootMarkers)
  const found: InstructionFile[] = []
  const seen = new Set<string>()
  for (const dir of ancestorChain(projectRoot, start)) {
    for (const names of [config.instructionFileCandidates, config.localInstructionFileCandidates]) {
      for (const name of names) {
        const absolutePath = join(dir, name)
        if (seen.has(absolutePath) || !isFile(absolutePath)) continue
        seen.add(absolutePath)
        found.push({ absolutePath, displayPath: displayPath(projectRoot, absolutePath) })
      }
    }
  }
  return found
}

/**
 * Convert an absolute path to a separator-stable project-relative display path.
 * @param projectRoot - root used as the display base.
 * @param path - absolute path to display.
 * @returns the root-relative path using forward slashes.
 */
function displayPath(projectRoot: string, path: string): string {
  const rel = relative(projectRoot, path)
  return isAbsolute(rel) ? rel : rel.split(sep).join('/')
}

/**
 * Whether a path exists, treating any probe failure as absence.
 * @param path - candidate path.
 * @returns true when `statSync` succeeds.
 */
function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a path is an existing regular file.
 * @param path - candidate path.
 * @returns true for a file, false for absence or a directory.
 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
