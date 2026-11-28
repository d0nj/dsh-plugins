# @d0nj/dsh-narration

Watches the agent work, inside the transcript.

The browser half replaces the rendered assistant row with a live one: the model's
reasoning streams expanded and auto-scrolling instead of collapsing into a
one-line preview, and a header carries phase, elapsed time and throughput so the
row is never a blank spinner. The answer still renders as Markdown through the
shipped renderer. Every tool call is rendered open, and shaped by what it
actually did: `edit` and `write` show a patch-viewer diff with a line-number
gutter and inline `+added −removed`, `apply_patch` shows its patch,
`bash`/`pwsh` show the command as a shell line, and command output previews as a
tail with a `… N earlier lines` control that expands in place.

The Host half adds one system-prompt section asking the model to state its intent
in a single sentence in the same message as every tool call, and to batch
independent read-only calls so they run concurrently.

## What is live

| Surface | Source | Cadence |
|---|---|---|
| Reasoning | `AssistantChatData.blocks` of kind `reasoning` | frame-paced drip, expands while streaming |
| Tool calls | `legacy.runningCalls` — preparing and dispatched | republished by the Chat snapshot |
| Partial arguments | `PartialArguments.text(...)` read during render | grows in place |
| Answer | `blocks` of kind `text` | shipped Markdown, `streaming` flag |
| Phase, elapsed, throughput | local clock and a windowed rate meter | 10 Hz |

Tokens are never painted straight off the wire. `PacedText` holds them in a FIFO
queue and releases them inside `requestAnimationFrame`: one or two characters per
frame while the backlog is shallow, accelerating to drain a deep backlog within
about six frames, and never splitting a surrogate pair.

## The trade this makes

A slot occupant cannot render the row's child slots, so replacing the assistant
row gives up what the shipped one contributed: the message action row (copy,
retry), inline images, quote gestures and the message context menu. The answer's
Markdown itself survives because the row renders it through the shipped
`conversation.chat.reasoning.content` factory, with body typography restored by
the injected stylesheet.

Set `liveReasoning: false` to restore the shipped row untouched. The prompt rules
are independent of that switch.

## Limits

The harness streams no foreground command output. The `bash` tool collects both
streams and returns them when the process exits, and no tool-level progress event
reaches the browser, so the row shows the command materialising plus the time it
has been running — not its stdout. Background jobs remain readable incrementally
through `job_output`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `liveReasoning` | `true` | Replace the assistant row with the live renderer |
| `verboseTools` | `true` | Render each tool call with its arguments and full output inline |
| `intentLine` | `true` | Require one sentence of intent per tool call |
| `parallelReads` | `true` | Ask for independent read-only calls in one message |
| `intentWords` | `24` | Upper bound on that sentence |

Typography and colour come from the theme: `--dsw-font-family`, the
`--dsw-font-*` scale and the `--dsw-alias-*` colour tokens. Nothing hardcodes a
family or a pixel size, so a theme change or a different font pairing applies
here too.

## Install

```bash
pnpm --filter @d0nj/dsh-narration build
```

Then install the package directory from **Plugins** > **Add plugin**, or:

```
plugin_manager install_bundle target=D:\projects\dsh-plugins\packages\narration
```

The client half is fetched on page load, so a reload is what picks up a rebuild.
