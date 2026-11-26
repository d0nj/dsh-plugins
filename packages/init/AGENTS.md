# Repository Guidelines — `@d0nj/dsh-init`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Host-side Cordis bundle that registers the `/init` slash command. The command is
a **prompt injector**: it builds a repository-survey brief, queues it as one
user-role message through `agent.followup`, and returns acknowledgement text. No
model request is made from the handler.

## Architecture & Data Flow

```
apply(ctx, config)                              src/index.ts
  → resolveFileName(ctx, config.fileName)       load-time guard, warns + falls back
  → ctx.commands.register({ name: 'init', input: { hint: '[focus]', attachments: true } })

/init <focus>                                   src/index.ts
  → ctx.workingDirectory.get(agent.session)     sync, no filesystem I/O
  → buildInitPrompt({ directory, fileName, focus, extraGuidance })   src/prompt.ts
  → agent.followup(createUserMessage({ content: [...attachments, text] }))
  → CommandResult.success
```

| File | Role | Key exports |
|---|---|---|
| `src/index.ts` | plugin entry, config, handler | `name`, `inject`, `Config`, `DEFAULT_FILE_NAME`, `COMMAND_DESCRIPTION`, `executeInitCommand`, `apply` |
| `src/prompt.ts` | brief composition | `buildInitPrompt`, `initTargetPath`, `InitPromptInput` |
| `src/prompt.test.ts` | unit suites | brief content, focus/guidance sections, ordering |
| `src/init.test.ts` | command unit suite | queued message shape, acknowledgement, config defaults |
| `src/integration.test.ts` | seam suite | real `CommandRuntime`, `/init` executed end to end |

### Invariants

- **`followup`, never a request.** The handler queues a turn; it must not await
  the work or drive the model. The GUI renders its success text immediately.
- **Attachments precede the text block**, matching `dsh-command-goal`: a reader
  meets the reference files before the instruction that names them.
- **The brief names the real target path**, resolved with `node:path.join`, so the
  model is never asked to infer a path from prose.
- **`fileName` is load-validated, not handler-validated.** A bad value warns once
  in `apply` and falls back; the handler never re-checks it.
- **`apply` returns the registry disposer.** It is the only registration the row
  owns.
- **No `definitionId`.** The command carries no first-party identity face; the
  field is documented as absent for definitions without identity-based client
  behavior, and the client face table is closed to third-party rows.

## Commands

```bash
pnpm --filter @d0nj/dsh-init build
pnpm --filter @d0nj/dsh-init test        # pretest compiles dist-test/, then node --test
pnpm --filter @d0nj/dsh-init typecheck
pnpm --filter @d0nj/dsh-init check       # node --check over dist/index.js and dist/prompt.js
```

`check` lists emitted files by hand — a new module must be added there or it
escapes the gate.

## Deps

Peers (mirrored in `devDependencies`): `@deepseek-ai/cordis ~4.1.0`,
`dsh-agent` / `dsh-commands` / `dsh-llm` / `dsh-working-directory` `^0.2.2-rc.5`,
`@deepseek-ai/schemastery ~3.19.0`. No runtime third-party libraries —
`node:path` only.
