import { join } from 'node:path'

export interface InitPromptInput {
  readonly directory: string
  readonly fileName: string
  readonly focus: string
  readonly extraGuidance: string
}

export function initTargetPath(directory: string, fileName: string): string {
  return join(directory, fileName)
}

export function buildInitPrompt(input: InitPromptInput): string {
  const target = initTargetPath(input.directory, input.fileName)
  const sections = [
    renderBrief(input, target),
    renderFocus(input.focus),
    renderGuidance(input.extraGuidance),
  ]
  return sections.filter(section => section.length > 0).join('\n\n')
}

function renderBrief(input: InitPromptInput, target: string): string {
  return `Create or update ${input.fileName} for this repository.

The goal is a compact instruction file that helps future DeepSeek Harness sessions avoid mistakes and ramp up quickly. Every line should answer: would an agent likely miss this without help? If not, leave it out.

Target file: ${target}

## Where DeepSeek Harness reads instruction files

DeepSeek Harness reads AGENTS.md, then CLAUDE.md, then AGENTS.local.md and CLAUDE.local.md, in every directory from the project root — the nearest ancestor holding .git — down to the session's working directory. Each file governs its own subtree, so the root file carries repository-wide rules while a nested one narrows them for that directory.

Write the root file unless what you learned is scoped to one subtree. Preferences that are not facts about this repository belong in the user-global ~/.dsh/AGENTS.md instead.

## How to investigate

Read the highest-value sources first:
- README, root manifests, workspace config, lockfiles
- build, test, lint, formatter, typecheck, and codegen config
- CI workflows and pre-commit or task-runner config
- existing instruction files: AGENTS.md, CLAUDE.md, .cursor/rules/, .cursorrules, .github/copilot-instructions.md

If the architecture is still unclear after config and docs, read a small number of representative source files to find the real entrypoints, package boundaries, and execution flow. Prefer the files that explain how the system is wired together over random leaf files.

Prefer executable sources of truth over prose. When docs conflict with config or scripts, trust the executable source and keep only what you verified.

## What to extract

- exact developer commands, especially non-obvious ones
- how to run a single test, a single package, or a focused verification step
- required command order when it matters, such as lint, then typecheck, then test
- monorepo or multi-package boundaries, ownership of major directories, and the real entrypoints
- toolchain quirks: generated code, migrations, codegen, build artifacts, env loading, dev servers, deploy flow
- testing quirks: fixtures, integration prerequisites, snapshot workflows, required services, flaky or expensive suites
- constraints from existing instruction files that are worth preserving

Good content is usually hard-earned context that took reading several files to infer.

## Questions

Ask only when the repository cannot answer something important. Use ask_user_question, one short batch at most, for undocumented team conventions, branch and release expectations, or known-but-unwritten setup prerequisites. Do not ask about anything the repository already makes clear.

## Writing rules

Include:
- exact commands and shortcuts an agent would otherwise guess wrong
- architecture notes that are not obvious from filenames
- conventions that differ from language or framework defaults
- setup requirements, environment quirks, and operational gotchas
- references to existing instruction sources that matter

Exclude:
- generic software advice
- tutorials or exhaustive file trees
- obvious language conventions
- claims you could not verify
- content better stored in another file and referenced from here

When in doubt, omit. Prefer short sections and bullets. If the repository is simple, keep the file simple; if it is large, summarize the few structural facts that actually change how an agent works.

## Existing file

If ${input.fileName} already exists at the target, improve it in place instead of rewriting it blindly: keep verified useful guidance, delete fluff and stale claims, and reconcile it with the current codebase.`
}

function renderFocus(focus: string): string {
  const text = focus.trim()
  if (text.length === 0) return ''
  return `## Focus for this pass

The user asked this pass to centre on the following. Honour it; do not let the rest of this brief dilute it.

${text}`
}

function renderGuidance(extraGuidance: string): string {
  const text = extraGuidance.trim()
  if (text.length === 0) return ''
  return `## Additional guidance

${text}`
}
