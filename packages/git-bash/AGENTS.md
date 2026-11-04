# Repository Guidelines — `@d0nj/dsh-git-bash`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Host-side Cordis bundle that puts Git Bash behind the `bash` tool on Windows. The
Windows default composes a PowerShell executor and disables the bash tool; this
bundle adds the bash tool back without disturbing the shipped `pwsh` one.

Unlike every other package here, the entry export is a **service class, not
`apply`** — `ctx.shell` is a single-implementation service, and subclassing
`ShellExecutor` *is* the registration.

## Architecture & Data Flow

```
cordis.patch.yml          group `git-bash`, isolate: {shell: git-bash}, win32-only
  → git-bash-executor     src/index.ts → GitBashExecutor (default export)
  → git-bash-tool         @deepseek-ai/dsh-tool-bash, unchanged, reads ctx.shell in this realm

GitBashExecutor           src/executor.ts   extends LocalBashExecutor
  → executable()          src/executor.ts   bashPath → resolveBash()
  → executeArgv(spec, [<bash>, '-c', command])
  → resolveBash           src/resolve.ts    config → GITBASH_PATH → install roots → PATH
```

| File | Role | Key exports |
|---|---|---|
| `src/index.ts` | plugin entry (class default export, no `apply`) | `GitBashExecutor`, default, `resolveBash` re-exports |
| `src/executor.ts` | the seam implementation | `GitBashExecutor`, `GitBashConfig` |
| `src/resolve.ts` | pure executable discovery | `resolveBash`, `installRoots`, `candidateExists`, `diagnose`, `BashOrigin`, `ResolvedBash` |
| `src/resolve.test.ts` | the only suite | 18 tests over discovery order and probes |

### Invariants

- **`sandboxMode` stays `undefined`.** The tool reads it to decide whether to advertise `sandbox_permissions`; a value here would promise escalation that cannot work.
- **Never import a second `ctx.shell` provider.** The realm owns exactly one executor.
- **`execute` may not use ECMAScript `#private` methods.** Cordis resolves a service through a proxy whose receiver is not the instance, so `this.#m()` throws "Receiver must be an instance of class". Use TypeScript `private` (which is not emitted as a lookup barrier).
- **The group is Windows-only.** `disabled: !!js process.platform !== 'win32'` keeps it from competing for the `bash` tool name on a host whose shipped stack already provides one.
- Resolution is pure: no `process.env`/`process.platform` read inside `resolveBash` — both arrive as parameters, so every branch is testable off Windows.

## Why not the shipped sandbox executor

`@deepseek-ai/dsh-bash-sandbox` wraps its command in the Windows ACL runner. That
runner's restricted token denies the signal pipe MSYS needs, so **every confined
Git Bash call dies before the command runs**:

```
bash: couldn't create signal pipe, Win32 error 5
```

`cmd`, `pwsh`, and `git` run fine under the same runner — only the MSYS runtime
fails. Hence an unconfined executor rather than a subclass of the sandbox one.

## Commands

```bash
pnpm --filter @d0nj/dsh-git-bash build        # tsc -p tsconfig.build.json → dist/
pnpm --filter @d0nj/dsh-git-bash test         # pretest compile → dist-test/, then node --test
pnpm --filter @d0nj/dsh-git-bash typecheck
pnpm --filter @d0nj/dsh-git-bash check        # node --check dist/index.js dist/executor.js
```

`check` lists emitted files by hand — a new entry module must be added to that script or it escapes the gate.

## Runtime verification

Tests cover discovery only; they cannot prove execution. The seam behaviour was
verified out-of-repo against the real `ctx.subprocess` (9/9): echo, pipes,
`MINGW64` identity, `git --version`, `/d/...` MSYS paths, nonzero exit codes,
`timeoutMs` kills, and incremental `readOutput` deltas. Re-verify after changing
`execute`:

```bash
node -e "..."   # mount isolate('shell','git-bash') + SubprocessLocal + GitBashExecutor
```

## Patch Config

One inserted group `git-bash` with `isolate: {shell: git-bash}`, `group: true`,
and `disabled` on non-Windows. Its `config` lists `git-bash-executor` (this
package) and `git-bash-tool` (`@deepseek-ai/dsh-tool-bash`).

## Deps

Peers (mirrored in `devDependencies`): `@deepseek-ai/cordis ~4.0.5`,
`dsh-bash-local` / `dsh-shell` / `dsh-subprocess` `0.2.1-rc.5`,
`@deepseek-ai/schemastery ~3.18.5`. No runtime third-party libraries — `node:fs`
and `node:path` only.
