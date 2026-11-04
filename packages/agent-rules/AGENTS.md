# Repository Guidelines — `@d0nj/dsh-agent-rules`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Host-side Cordis bundle that makes `AGENTS.md` binding. It registers the
user-global file and the project's own chain as **system-prompt sections**, and
disables the shipped advisory loader so exactly one presentation reaches the model.

The problem it solves is framing, not discovery: `@deepseek-ai/dsh-agent-instructions`
injects the same bytes as a **user-role `<system-reminder>`** introduced as
"guidance when applicable; more specific instructions take precedence". A model
can set that aside whenever it finds a more specific-sounding sentence — its own
tool description, a repo file, or a convenience-driven plan. A system section
carries the authority the reminder lacks.

## Architecture & Data Flow

```
apply(ctx, config)
  → readRulesFile(resolveDshHome())        src/file.ts      global AGENTS.md, once at load
  → ctx.on('agent/created')                src/index.ts     per-agent, because cwd is per-session
      → ctx.workingDirectory.get(session)  the session's committed directory
      → discoverInstructionFiles(cwd)      src/discover.ts  project root → cwd, broadest first
      → renderRulesFor / renderSection     src/render.ts    blocks + binding header/footer
      → agent.ctx.systemPrompt.section({ name: 'agent-rules:instructions', interpolate: false })
```

| File | Role | Key exports |
|---|---|---|
| `src/index.ts` | plugin entry, per-agent registration | `name`, `inject`, `Config`, `RULES_SECTION`, `apply`, `globalRulesPath` |
| `src/file.ts` | home resolution + bounded read | `resolveDshHome`, `rulesFilePath`, `readRulesFile`, `RulesRead` |
| `src/discover.ts` | project-root walk and ancestor chain | `findProjectRoot`, `ancestorChain`, `discoverInstructionFiles`, `resolveDiscoveryConfig` |
| `src/render.ts` | prompt text composition | `HEADER`, `FOOTER`, `renderRulesFor`, `renderSection` |
| `src/rules.test.ts` | unit suites | rendering, discovery, reading |
| `src/integration.test.ts` | seam suite | real `SystemPrompt`, real `agent/created`, scoped assembly |

### Invariants

- **A section name of its own.** `RULES_SECTION` must not be `deployment:persona-prefix`:
  agent presets shadow that name deliberately, so rules placed there disappear
  under any preset that sets a persona.
- **`interpolate: false` always.** Sections resolve `{{name}}` and throw on an
  unknown one. Operator prose may contain braces; a stray `{{` must never break
  prompt assembly for a session.
- **Register through `agent.ctx`, not the plugin's `ctx`.** The section must be
  scoped to the agent, and `agent.ctx` inherits the plugin fiber's `inject`.
  Reaching `ctx.systemPrompt` from a context that did not declare it throws
  `cannot get property "systemPrompt" without inject`.
- **Registration happens on `agent/created`.** The repo chain depends on the
  session's working directory, so it cannot be resolved once at load.
- **`agent/created` is serial**: the listener must return `undefined` explicitly.
- The global file is read **once at activation**, so editing it needs a Harness
  restart. That is the cost of putting the text in the system message.

## Why the patch also disables the shipped loader

`cordis.patch.yml` inserts this row and disables
`@deepseek-ai/dsh-agent-instructions` in four places: the top-level row and one
child inside each of the `standard`, `ptc`, and `cordis` presets (`minimal` has
no instruction row).

**A preset row's `config` is replaced wholesale, never deep-merged**, so each
preset override restates the shipped plugin list verbatim with one child
disabled. Do not "simplify" those overrides to just the disabled child: that
silently deletes every tool in the preset. The file is long because the format
requires it.

Re-derive them after a `dsh` upgrade that changes a preset:

```bash
dsh --profile web --dump-default-config > /tmp/default.yml
```

## Commands

```bash
pnpm --filter @d0nj/dsh-agent-rules build
pnpm --filter @d0nj/dsh-agent-rules test        # pretest compiles dist-test/, then node --test
pnpm --filter @d0nj/dsh-agent-rules typecheck
pnpm --filter @d0nj/dsh-agent-rules check       # node --check over every emitted module
```

`check` lists emitted files by hand — a new module must be added there or it
escapes the gate.

## Deps

Peers (mirrored in `devDependencies`): `@deepseek-ai/cordis ~4.0.5`,
`dsh-agent` / `dsh-system-prompt` / `dsh-working-directory` `0.2.1-rc.5`,
`@deepseek-ai/schemastery ~3.18.5`. No runtime third-party libraries —
`node:fs`, `node:os`, and `node:path` only.
