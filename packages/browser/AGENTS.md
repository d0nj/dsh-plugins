# Repository Guidelines — `@d0nj/dsh-browser`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Host-side Cordis bundle that registers the `browser` tool: one Chromium-family browser driven over the DevTools protocol. No runtime third-party dependency — the WebSocket client, frame codec, launch, and page operations live here.

## Architecture & Data Flow

```
apply(ctx, config)                 src/index.ts   resolve settings, own the host, register the tool
  → BrowserHost                    src/host.ts    one browser, named tabs, idle close, lifecycle
      → launch/reuse/attach        src/launch.ts  executable discovery, DevToolsActivePort, attach
          → CdpClient              src/cdp.ts     command/event correlation over one socket
              → openWebSocket      src/ws.ts      RFC 6455 handshake and framing
      → IdleCloser                 src/idle.ts    close after a quiet period
      → Tab                        src/tab.ts     navigate/snapshot/click/type/… per target session
          → renderAccessibilityTree src/snapshot.ts  Accessibility AX nodes → numbered outline
  → applyBrowserTool               src/tool.ts    defineTool schema, action dispatch, formatting
```

| File | Role | Key exports |
|---|---|---|
| `src/index.ts` | plugin entry, Config schema, settings resolution | `name`, `inject`, `Config`, `apply`, `resolveSettings`, `resolveDshHome` |
| `src/host.ts` | browser and tab lifecycle, idle close, one browser per plugin | `BrowserHost`, `BrowserSettings`, `BrowserHostDeps`, `resolveUserDataDir` |
| `src/idle.ts` | idle deadline that starts and stops around work | `IdleCloser` |
| `src/launch.ts` | find/start/attach/stop, DevToolsActivePort | `executableCandidates`, `findExecutable`, `readActivePort`, `probeVersion`, `resolveCdpAddress`, `reuseBrowser`, `launchChrome`, `stopBrowser`, `describeLaunchFailure` |
| `src/cdp.ts` | CDP request/response + events, flattened sessions | `CdpClient`, `CdpError` |
| `src/ws.ts` | WebSocket handshake, frames, fragmentation, ping/pong | `openWebSocket`, `FrameDecoder`, `encodeFrame`, `OPCODE` |
| `src/tab.ts` | one tab: navigation, refs, input, screenshots | `Tab`, `normalizeUrl`, `refFromSelector`, `TabSettings`, `ElementTarget` |
| `src/snapshot.ts` | pure AX-tree projection | `renderAccessibilityTree`, `INTERACTIVE_ROLES`, `normalizeText` |
| `src/keys.ts` | chord → CDP key event fields | `parseKeyChord`, `MODIFIER` |
| `src/console.ts` | bounded console ring, remote-object rendering | `ConsoleBuffer`, `describeRemoteObject` |
| `src/tool.ts` | model-facing tool, output projection, prompt section | `applyBrowserTool`, `BROWSER_ACTIONS`, `wrapPage`, `formatConsole`, `formatEvaluated`, `formatTabs`, `imageReference` |
| `src/ws-server.helper.ts` | in-process WebSocket/CDP server for tests | `startWebSocketServer`, `startCdpServer` |

### Invariants

- **Refs belong to one snapshot.** `Tab` renumbers from `e1` on every snapshot and clears the table on `Page.frameNavigated` of the main frame. A stale or unknown ref must fail with the message that says to take a new one — never resolve a stale backend node id.
- **Act on real input events.** Clicks are `Input.dispatchMouseEvent` at the element's centre after `scrollIntoView`; typing focuses the element and uses `Input.insertText`. Do not fall back to `element.click()`: it skips pointer semantics and hover menus.
- **Every mutating action settles.** `#settle()` waits for `document.readyState === 'complete'` with a bounded budget; a page that never finishes loading still returns, so the snapshot shows what is there.
- **One browser, named tabs.** `BrowserHost` owns a single browser process and a `Map<name, Tab>`; tabs are created lazily. Any tab action uses the same instance, so a page survives between tool calls.
- **Idle means quiet, not unfocused.** The idle clock restarts on every CDP *command* (`CdpClient.onActivity`), never on events: a page's own console chatter or timers must not keep the browser alive, and a call that keeps talking to the page keeps the browser up. Activity is the single source of liveness.
- **The browser outlives calls, not the idle deadline.** After `idleCloseSeconds` without a command, `closeIdleBrowser` closes tabs and the browser, and the next call relaunches it with the same profile. Disposal does the same through `ctx.effect`. A `cdpUrl` attach is `managed: false` and is never closed — only the tabs this plugin created there.
- **Only one provider of the browser process.** `cdpUrl` attach wins over `reuseBrowser`, which wins over launch; a failed connection clears the cached promise so the next call retries. A browser found on the plugin's own profile counts as `managed`, so it is still subject to idle close.
- **Silent refusals are bugs.** Launch failures carry the browser's stderr; Edge's `RemoteDebuggingAllowed` refusal is detected and names the fix (`describeLaunchFailure`).
- **Output is one envelope.** `wrapPage` marks page-derived text; the tool's `render` is pure and never throws; screenshots go through `ctx.attachments.saveImage` only when the calling route declares image input, otherwise to a temp PNG path.

## Commands

```bash
pnpm --filter @d0nj/dsh-browser build       # tsc -p tsconfig.build.json → dist/
pnpm --filter @d0nj/dsh-browser test        # pretest compiles dist-test/, then node --test
pnpm --filter @d0nj/dsh-browser typecheck   # tsc -p tsconfig.test.json --noEmit
pnpm --filter @d0nj/dsh-browser check       # node --check on emitted entry modules
cd packages/browser && node --test dist-test/snapshot.test.js
node --test --test-name-pattern="refs" "dist-test/**/*.test.js"
```

`check` lists emitted files by hand — a new emitted entry module must be added to that script or it escapes the gate.

## Tests

`node:test` + `node:assert/strict`, offline, over `dist-test/`.

| File | Covers |
|---|---|
| `src/ws.test.ts` | handshake, text frames, fragmentation, ping/pong, close codes, refusals |
| `src/cdp.test.ts` | request correlation, session ids, protocol errors, timeouts, event waits, close |
| `src/snapshot.test.ts` | outline shape, ref numbering, transparent nodes, state attributes, budgets |
| `src/keys.test.ts` | key table, chords, modifiers, unknown-key messages |
| `src/launch.test.ts` | candidate discovery per platform and package manager, DevToolsActivePort, failure text |
| `src/tab.test.ts` | `normalizeUrl`, `refFromSelector` |
| `src/console.test.ts` | remote-object rendering, ring bounds |
| `src/tool.test.ts` | envelope, console/value/tab formatting, image reference |

Patterns: `ws-server.helper.ts` (excluded from `dist/` by `tsconfig.build.json`) starts a real `node:http` upgrade server, so the transport is exercised for real. Browser-level behavior is a manual check — `node:test` here never starts a browser.

## Patch Config

`cordis.patch.yml` inserts one row, `browser`, with no config, so the defaults above apply. A profile's own patch outranks it; `cdpUrl`, `executablePath`, and `userDataDir` are the usual overrides. Do not insert the tool into an agent preset: the row is global so every preset sees it.

## Deps

Peers (mirrored in `devDependencies` for types): `@deepseek-ai/cordis ~4.1.0`, `dsh-attachment` / `dsh-llm` / `dsh-system-prompt` / `dsh-tools` `^0.2.2-rc.1`, `schemastery ~3.19.0`. Runtime imports are `@deepseek-ai/dsh-tools` (`defineTool`), `@deepseek-ai/dsh-attachment` (`AttachmentId`), `@deepseek-ai/schemastery`, and Node builtins (`node:http`, `node:crypto`, `node:child_process`) — no puppeteer, no playwright.
