# `@d0nj/dsh-agent-rules`

Makes the user-global `AGENTS.md` binding.

## Why

`~/.dsh/AGENTS.md` already reaches every agent, through the shipped
`@deepseek-ai/dsh-agent-instructions` row. But that row delivers it as a
**user-role `<system-reminder>`** introduced with:

> The following workspace instructions may be relevant to your work. Use them as
> guidance when applicable. More specific instructions take precedence over
> broader ones. They do not override system, developer, or direct user instructions.

That framing is the whole problem. A rule read as *"may be relevant… guidance…
take precedence [when specific]"* is a rule a model can set aside whenever it
finds a more specific-sounding sentence — its own tool description, a repo file,
or a convenience-driven plan. The rules are present and still lose.

This bundle re-reads the same file and registers it with `ctx.systemPrompt`
instead, so the text lands in the **system message**, introduced as what it is:
binding instructions from the operator.

## What it does

One row, `agent-rules`:

```
~/.dsh/AGENTS.md   ($DSH_HOME honored)
  → rendered with a binding header and a precedence footer
  → ctx.systemPrompt.section({ name: 'agent-rules:user-global', order: 1, interpolate: false })
```

Design notes:

- **A section name of its own.** `deployment:persona-prefix` is the tempting slot
  for extra policy, but agent presets shadow that name deliberately — rules put
  there disappear under any preset that sets a persona. `agent-rules:user-global`
  is contributed by this row alone, so no preset can shadow it by accident.
- **`interpolate: false`.** Prompt sections resolve `{{name}}` references and
  throw on an unknown one. A rules file is operator prose that may legitimately
  contain braces; a stray `{{` must never be able to break prompt assembly.
- **Order `1`.** Immediately after the deployment persona, before every tool
  section, so standing instructions read as scope for the work rather than as one
  more tool note.
- **No duplicate suppression.** The `agent-instructions` copy still loads and
  still refreshes when the file changes. That duplicate is intentional: the
  reminder keeps the file discoverable, this row makes it binding. To drop the
  duplicate instead, disable the `agent-instructions` row in the preset.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `$DSH_HOME/AGENTS.md` (else `~/.dsh/AGENTS.md`) | Absolute path to read. |

A missing file is the ordinary unconfigured state and registers nothing. A file
that exists but is unreadable, or holds no rules after the title, logs a warning
— silently leaving an agent without rules the operator believes are in force is
the one failure this plugin exists to prevent.

## Changes take effect

The file is read once at activation. Editing `AGENTS.md` therefore requires a
Harness restart, unlike the `agent-instructions` copy which live-reloads. This is
the cost of putting the text in the system message, which is assembled per step
from registrations fixed at load time.

## Commands

```bash
pnpm --filter @d0nj/dsh-agent-rules build
pnpm --filter @d0nj/dsh-agent-rules test
pnpm --filter @d0nj/dsh-agent-rules typecheck
pnpm --filter @d0nj/dsh-agent-rules check
```

## Deps

Peers (mirrored in `devDependencies`): `@deepseek-ai/cordis ~4.1.0`,
`dsh-agent` / `dsh-system-prompt` / `dsh-working-directory` `^0.2.2-rc.1`,
`@deepseek-ai/schemastery ~3.19.0`.
No runtime third-party libraries — `node:fs`, `node:os`, and `node:path` only.
