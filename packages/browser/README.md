# @d0nj/dsh-browser

A real browser for DeepSeek Harness agents, headless by default. One `browser` tool opens a page, reads it as a numbered accessibility outline, and clicks, types, and scrolls by the refs in that outline.

```text
open https://github.com/login
<page tab="main" url="https://github.com/login" title="Sign in to GitHub">
- main
  - heading "Sign in to GitHub" [level=1]
  - textbox "Username or email address" [ref=e3]
  - textbox "Password" [ref=e4]
  - link "Forgot password?" [ref=e5] [url=https://github.com/password_reset]
  - button "Sign in" [ref=e9]
</page>
```

`type` into `e4`, `click` `e9`, and the next result is the page that came back.

## Why it exists

`web_fetch` returns HTML for one URL; it cannot log in, submit a form, wait for a client-rendered page, or read what a screen reader would announce. `browser` drives a real Chromium-family browser over the DevTools protocol with no third-party runtime dependency: the WebSocket client, frame codec, launch, and page operations are in this package, so it works on whichever Node the Harness bundles.

## Install

```text
plugin_manager({ action: "install_bundle", target: "<absolute path to this repo>/packages/browser" })
```

Nothing else is needed when Chrome, Chromium, Brave, or Edge is installed: the plugin finds it, starts it on first use with a profile of its own (`$DSH_HOME/browser/default`), closes it a minute after the last browser call, and stops it when the plugin unloads. It starts headless, so agent work never puts a window in front of you; set `headless: false` for one session when you need to watch it or sign in to a site, and the persistent profile keeps that session afterwards.

## Configuration

Set any of these on the `browser` row of the profile's `cordis.patch.yml`; every key has a working default.

| Key | Default | What it does |
|---|---|---|
| `toolName` | `browser` | Registered tool name. |
| `executablePath` | auto-detect | Browser binary. Auto-detection covers Program Files, `%LOCALAPPDATA%`, Scoop, Chocolatey, `/Applications`, and Linux package paths; `CHROME_PATH` is honored too. |
| `cdpUrl` | — | Attach to a browser the user already started with `--remote-debugging-port=9222` instead of launching one. Accepts an HTTP origin or a `ws://` URL. |
| `headless` | `true` | No window. Set `false` to watch the browser, or to sign in to a site once. A headed tab must stay foregrounded: Chrome does not deliver coordinate clicks to an occluded tab. |
| `userDataDir` / `profile` | `$DSH_HOME/browser/default` | Profile directory. It persists, so logging in once keeps the session. |
| `width` / `height` | `1280` / `900` | Window and viewport size. |
| `dialogs` | `accept` | Answer `alert`/`confirm`/`prompt` automatically, or `dismiss`. |
| `launchArgs` | `[]` | Extra browser flags, e.g. a proxy. |
| `navigateTimeoutMs` / `startupTimeoutMs` | `20000` / `20000` | Load and launch budgets. |
| `maxSnapshotChars` | `12000` | Default outline budget; `maxChars` per call overrides it. |
| `idleCloseSeconds` | `60` | Close the browser this long after its last command. `0` keeps it until the plugin unloads; never applies to a `cdpUrl` browser the user owns. |

## Actions

`open`, `snapshot`, `click`, `type`, `press`, `hover`, `select`, `scroll`, `wait`, `evaluate`, `screenshot`, `console`, `tabs`, `close`, `back`, `forward`, `reload`.

Every page action returns a fresh snapshot unless `snapshot` is `false`, so a click and its result cost one call. Refs are numbered per snapshot and cleared on navigation; a stale ref fails with the message to take a new one. `snapshot` can be scoped with `selector` to keep large pages small. `screenshot` attaches the PNG when the model accepts images and writes it to a temp file otherwise.

## Security

- Page text, console output, and `evaluate` results are untrusted data. The plugin adds a system-prompt section that says so, and every page body is wrapped in `<page …>` so the model can tell it from tool prose.
- The browser profile holds whatever the user logged into while using this window; it is not the everyday browser profile, and the everyday browser keeps running untouched.
- `evaluate` runs in the page's own world with the page's own permissions, so it cannot reach files or the host process.

## Development

```bash
pnpm --filter @d0nj/dsh-browser build      # tsc → dist/
pnpm --filter @d0nj/dsh-browser test       # compile dist-test/, then node --test
pnpm --filter @d0nj/dsh-browser typecheck
pnpm --filter @d0nj/dsh-browser check      # node --check on emitted entries
```

Tests are offline: the transport suites run against an in-process WebSocket server, and the page-outline suites run on recorded accessibility trees. Driving a real browser is a manual check, not a test.
