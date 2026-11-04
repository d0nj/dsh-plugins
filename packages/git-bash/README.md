# `@d0nj/dsh-git-bash`

Git Bash as the DeepSeek Harness shell on Windows.

The Windows default composes a PowerShell executor and disables the bash tool
entirely. This bundle adds a working `bash` tool beside it, running Git Bash,
without touching the PowerShell one.

## What you get

| Capability | Source |
|---|---|
| `bash` tool (`bash -c`) | the shipped `@deepseek-ai/dsh-tool-bash`, unchanged |
| Background jobs, timeout promotion | shipped tool, through `ctx.jobs` |
| Bounded output with spill files | shipped executor mechanics |
| `DSH_*` environment injection | shipped tool, through `ctx.shellEnv` |
| Git Bash discovery | this package |

Interactive `bash` state does not persist between calls; each call is a fresh
`bash -c`, exactly like the shipped tool.

## Install

```text
plugin_manager({ action: "install_bundle", target: "<repo>/packages/git-bash" })
```

Restart the Harness after installing: the Host runs plugin modules in-process,
so a changed or newly added module needs a restart before it loads.

## How it fits into the composition

`ctx.shell` is a single-implementation service: whichever executor claims it
decides the dialect of every shell tool in that composition. Rather than evict
the shipped PowerShell executor, the bundle mounts its own group with an
isolated `shell` realm:

```yaml
- id: git-bash
  name: cordis:group
  group: true
  isolate:
    shell: git-bash
  disabled: !!js process.platform !== 'win32'
  config:
    - id: git-bash-executor
      name: '@d0nj/dsh-git-bash'
    - id: git-bash-tool
      name: '@deepseek-ai/dsh-tool-bash'
```

Inside that realm `ctx.shell` is `GitBashExecutor`, so the shipped bash tool runs
Git Bash. Outside it, `pwsh` keeps the shipped sandboxed executor. The group is
disabled off Windows, where the shipped stack already provides a working `bash`.

## Executable resolution

`resolveBash` picks, in order:

1. `bashPath` from the row config.
2. `GITBASH_PATH` from the environment.
3. A Git for Windows install under `ProgramFiles`, `ProgramW6432`,
   `ProgramFiles(x86)`, or `LOCALAPPDATA\Programs` (`Git\bin\bash.exe`, then
   `Git\usr\bin\bash.exe`, then `Git\usr\bin\sh.exe`).
4. Bare `bash`, resolved by the subprocess seam's own PATH lookup.

## Sandboxing

This executor deliberately does not confine commands, and `sandboxMode` stays
`undefined` so the tool omits `sandbox_permissions` instead of advertising an
escalation that cannot work.

Git Bash cannot start under the Windows ACL sandbox runner: the restricted token
denies the signal pipe MSYS needs, and every confined call dies before the
command runs (`bash: couldn't create signal pipe, Win32 error 5`). `cmd`, `pwsh`,
and `git` all run fine under the same runner — only Git Bash's MSYS runtime fails.

## Config

| Key | Default | Meaning |
|---|---|---|
| `bashPath` | — | Explicit `bash.exe`; wins over all discovery |
| `cwd` | `process.cwd()` | Default working directory |
| `timeoutMs` | `120000` | Default foreground timeout |
| `maxTimeoutMs` | `600000` | Upper bound for per-call timeouts |
| `maxOutputBytes` | `64000` | Per-stream in-memory cap |
| `maxSpillBytes` | `67108864` | Per-stream spill-file cap |
| `graceMs` | `3000` | Kill-escalation grace period |

## Verify

```bash
pnpm --filter @d0nj/dsh-git-bash build
pnpm --filter @d0nj/dsh-git-bash test
```

Live, in a session on Windows:

```text
bash({ description: "Identify the shell", command: "uname -s; echo $MSYSTEM; which bash" })
```

expects `MINGW64_NT-…`, `MINGW64`, and a `Git/bin/bash.exe` path.
