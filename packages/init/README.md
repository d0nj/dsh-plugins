# `@d0nj/dsh-init`

Adds the `/init` command: a guided pass that surveys the repository and writes
or refreshes its `AGENTS.md`.

## What it does

```
/init [focus]
  → the handler resolves the session's working directory
  → builds one survey brief (fixed instructions + focus + row guidance)
  → agent.followup(user message)          ← an ordinary turn does the work
  → returns "Surveying <dir> for AGENTS.md."
```

The command sends the model nothing itself. It appends **one user-role message**
carrying the brief and returns acknowledgement text, so `/init` behaves like a
prompt the user typed: it opens a normal turn, it is cancellable, it is visible
in the transcript, and its reading and writing show up as ordinary agent
activity rather than as hidden command machinery.

## Why the brief says where instruction files live

DeepSeek Harness reads `AGENTS.md`, then `CLAUDE.md`, then `AGENTS.local.md` and
`CLAUDE.local.md`, in every directory from the project root (nearest ancestor
holding `.git`) down to the session's working directory. Each file governs its
own subtree.

A model that does not know that rule writes repo-wide conventions into a nested
package file, or dumps personal preferences into the repository. The brief states
the chain, says to write the root file unless the finding is scoped to one
subtree, and points non-repository preferences at the user-global
`~/.dsh/AGENTS.md`.

## What the brief asks for

The fixed instructions are the hard-won part, not the plumbing: read
configuration and CI before source, prefer executable sources of truth over
prose, extract exact commands and non-obvious structure, ask at most one short
batch of questions, and improve an existing file in place instead of rewriting
it blindly. Everything that cannot be verified is meant to be dropped.

## Install

```text
plugin_manager({ action: "install_bundle", target: "<repo>/packages/init" })
```

Then restart the Harness: the Host loads `dist/index.js`, so a rebuild needs a
restart.

## Config

| Key | Default | Meaning |
|---|---|---|
| `fileName` | `AGENTS.md` | Instruction file to create or update, relative to the session directory. A nested path such as `packages/app/AGENTS.md` is honoured. |
| `extraGuidance` | `""` | Extra guidance appended to the brief, for repository conventions this plugin cannot know. |

`fileName` is refused when it is absolute or contains `..`: the value reaches a
model as a write instruction, so an escape from the session directory is a
footgun rather than a preference. The row warns once at load and falls back to
`AGENTS.md`.

## Verify

```bash
pnpm --filter @d0nj/dsh-init test
```

The suite mounts the real `CommandRuntime` and executes `/init` end to end, so a
definition the registry rejects, an unresolvable name, or a handler that never
queues its turn fails the build rather than the GUI.
