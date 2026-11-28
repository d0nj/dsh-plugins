# Repository Guidelines — `@d0nj/dsh-narration`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Split Host/browser Cordis bundle: a system-prompt contract that makes the agent state its intent before every action, and a replacement `assistant-step` Chat renderer that shows the turn while it happens — streaming reasoning, tool calls whose arguments are still being generated, elapsed time and throughput.

## Architecture & Data Flow

```
src/index.ts        (Host)     Config schema; registers one system-prompt section
src/narration.ts    (shared)   pure prompt text builder (SECTION_NAME, SECTION_ORDER)
src/pacing.ts       (shared)   frameBudget, PacedText FIFO queue, RateMeter
src/live.ts         (shared)   tool narration catalog, phase resolution, path splitting
src/diff.ts         (shared)   pure LCS line diff with context collapsing and truncation
src/ansi.ts         (shared)   terminal text normalization and SGR parsing into theme tones
src/client/index.ts (browser)  stylesheet, and the two chat-node occupants behind the mode switches
src/client/assistant.ts (browser) the assistant row renderer and its frame-paced loop
src/client/tool.ts  (browser)  the verbose tool-call renderer, recursive over subcalls
src/client/style.ts (browser)  one stylesheet, theme tokens only
scripts/stamp-client.mjs       rewrites tsc ESM output into the browser loader envelope
```

| File | Key exports |
|---|---|
| `src/index.ts` | `name`, `inject = ['systemPrompt']`, `Config`, `PluginConfig`, `apply` |
| `src/narration.ts` | `SECTION_NAME`, `SECTION_ORDER`, `buildNarrationSection`, `NarrationOptions` |
| `src/pacing.ts` | `frameBudget`, `PacedText`, `RateMeter` |
| `src/live.ts` | `TOOL_NARRATION`, `narrateCall`, `splitPath`, `summarize`, `phaseLabel`, `formatElapsed`, `formatRate`, `clip` |
| `src/client/index.ts` | `CHAT_SLOT`, `ASSISTANT_KEY`, `TOOL_KEY`, `SHADOW_PRIORITY`, `flagsOf`, `useReact`, `installStyles`, `apply` |
| `src/client/assistant.ts` | `createAssistantNarration`, `assistantStatus`, `blocksOf`, `textOfBlocks`, `toLiveCalls`, `REASONING_FACTORY`, `AssistantNodeProps` |
| `src/client/tool.ts` | `createToolNarration`, `toolRoot`, `toolPhase`, `toolArgsText`, `toolOutputText`, `toolDuration`, `liveCallOf` |

### Data flow

1. `ctx.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text })` — 700, ahead of the tool sections at 1000+.
2. The row registers as the `assistant-step` occupant of `conversation.chat.node`, replacing the shipped renderer while `liveReasoning` is on.
3. `props.node.data.blocks` and `props.node.data.status` are the step's own live blocks; `useChat(s => s.legacy.runningCalls)` supplies every unsettled tool call; `useSession(s => s.running)` supplies liveness.
4. Reasoning goes through `PacedText`, drained inside `requestAnimationFrame`; the answer goes to `renderFactorySlot('conversation.chat.reasoning.content', …)` with `streaming` set while the step runs.

## Invariants

- **The mode switch is a real disposer.** `liveReasoning: false` must call the `slots.inject` disposer, which restores the shipped occupant; never leave both registered.
- **Selectors return stable references or primitives.** `legacy.runningCalls` and `running` are separate selector calls; a selector that builds an object per call would republish on every chunk.
- **Hook order is constant.** Missing hooks fall back to a module-level `NO_SELECT`, so the count never changes between renders.
- **The answer never loses Markdown.** It is rendered through the shipped reasoning content factory, and the injected stylesheet restores body size and primary colour on that factory's root. Do not replace it with plain text.
- **One node, two rows.** The process grouping emits an `assistant-step` node twice: once with `groupPart: 'reasoning'` inside the step run and once with `groupPart: 'response'` as the reply. A renderer that ignores `groupPart` draws the whole step on both rows and every message appears twice. `reasoning` renders the header, roster and thinking; `response` renders the answer; no `groupPart` renders everything.
- **Output and diffs follow the tail.** A scrollable pane pins to the bottom on every render until the user scrolls up, then unpins; expanding resets the pin. Never force a scroll position the reader chose.
- **`node`, `data` and `blocks` are untrusted.** Every read narrows structurally; a malformed node degrades instead of throwing, because a throwing occupant blanks the row.
- **Frame pacing never splits a surrogate pair.** `PacedText.take` steps back one unit when a cut lands mid-pair.
- **Theme tokens only.** Text uses `var(--dsw-font-family)`; monospace uses `var(--dsw-font-markdown-code-block-font-family, …)`; sizes read the `--dsw-font-*-font-size` scale with a pixel fallback; every colour is `--dsw-alias-*`. A literal family or size is a bug.
- **The depth-drain bound is load-bearing.** A deep backlog must clear in about six frames or the drip falls permanently behind the model.

## Limits

Foreground command output is never streamed by the harness: `bash` collects stdout and stderr and returns them when the process exits, and no tool-level progress event reaches the browser. The row shows the command materialising plus its elapsed time, not its output. Do not add a socket, poller, or fake output to compensate.

A slot occupant cannot render the row's child slots. The replacement therefore does not render `conversation.chat.assistant-actions`, `conversation.chat.message.images`, or the reasoning body slot; that is why the mode switch exists and why it is documented in the README.

## Commands

```bash
pnpm --filter @d0nj/dsh-narration build      # tsc -p tsconfig.build.json && node scripts/stamp-client.mjs
pnpm --filter @d0nj/dsh-narration test       # pretest compile → dist-test/, then node --test
pnpm --filter @d0nj/dsh-narration typecheck
pnpm --filter @d0nj/dsh-narration check      # node --check over the emitted entry points
```

## Tests

`node:test` + `node:assert/strict` over `dist-test/`. `src/pacing.test.ts` covers the drip curve and the queue; `src/live.test.ts` covers tool narration, path splitting and phase resolution; `src/narration.test.ts` covers the prompt text; `src/client/assistant.test.ts` and `src/client/tool.test.ts` render the rows through a recording `createElement` shim and assert the tree, which is the only check that runs without a browser.

## Browser-Half Constraints

Same as [`../ui-custom/AGENTS.md`](../ui-custom/AGENTS.md): no JSX, no non-relative imports, services reached through `ctx` (declared in `dsh.client.inject` for ordering only), React handed in by the stamped envelope through `useReact`.

## Patch Config

`cordis.patch.yml` inserts one row, `id: narration`, with `intentLine`, `parallelReads` and `intentWords`. It deliberately omits `liveReasoning` and `verboseTools`: those come from the schema defaults, so a profile written by an older build still validates. The row id is the settings namespace the browser half reads through `configForms.get('narration')`, so the row id and that argument must stay in sync.

## Deps

Peers: `@deepseek-ai/cordis ~4.1.0`, `@deepseek-ai/schemastery ~3.19.0` (mirrored in `devDependencies`). The Host service is declared in `inject` and typed structurally; the client services come from `ctx` and are never imported.
