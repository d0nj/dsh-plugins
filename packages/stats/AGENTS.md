# Repository Guidelines — `@d0nj/dsh-stats`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Split Host/browser Cordis bundle for the DeepSeek Harness Web UI: a **Token usage** page in the left sidebar that totals input, cached input, cache writes and output across every stored Session, and prices the result from the models.dev catalog.

## Architecture & Data Flow

```
src/index.ts          (Host)     route, price catalog cache, projection reads, bounded log scan
src/summary.ts        (shared)   pure fold: usage events + session meta → page payload
src/tokens.ts         (shared)   TokenTotals vocabulary and provider-usage readers
src/pricing.ts        (shared)   catalog index, price resolution rules, cost math
src/client/index.ts   (browser)  registers the sidebar entry and the main panel
src/client/page.ts    (browser)  page view, charts, request state
src/client/chart.ts   (browser)  pure chart geometry (fractions, donut arcs, columns)
src/client/format.ts  (browser)  pure value formatting
scripts/stamp-client.mjs         rewrites tsc ESM output into the browser loader envelope
```

| File | Role |
|---|---|
| `src/index.ts` | `name`/`inject`/`Config`/`apply`; registers `GET /d0nj-stats/summary`; owns the background scan and the price-catalog TTL cache |
| `src/summary.ts` | `summarize`, `UsageEvent`, `SessionMeta`, `StatsPayload`, `dayOf` |
| `src/pricing.ts` | `buildPriceIndex`, `resolvePrice`, `costOf`, `median`, `normalizeModelId` |
| `src/tokens.ts` | `TokenTotals`, `addTokens`, `makeTokens`, `tokensOfUsage` |
| `src/client/index.ts` | `PANEL_ID`, `useReact`, `apply` |
| `src/client/page.ts` | `createStatsPage(React)` |
| `src/client/icon.ts` | `createStatsIcon(React)` |
| `src/client/chart.ts` | `fractions`, `groupSmall`, `donutArcs`, `columnHeights` |
| `src/client/format.ts` | `formatTokens`, `formatUsd`, `formatPercent`, `formatDate`, `formatMoment`, `formatDayLabel`, `formatBasis`, `formatPrice`, `formatModel` |

### Two data paths, and why

1. **Fast, always exact: lifetime totals.** `ctx.sessionProjectionCache.cachedSnapshot(header, ['tokenUsage'])` reads the projection the Harness already folds per Session. This is a zero-I/O listing read, so 700 Sessions cost a few hundred object reads instead of 700 log replays.
2. **Exact where it matters: model and day attribution.** `tokenUsage` totals have no model or timestamp, and `modelSelection` only says which model a Session used *last*. `ctx.sessionQuery.readSession()` replays one log at a time, so the Host replays only the largest `scanSessions` Sessions, in the background, and caches the result for the process lifetime. Everything else is attributed to its last-used model and start day.

## Invariants

- **The page never waits on the scan.** `buildPayload` starts the scan and returns the projection payload with `scan.running = true`; the browser half polls until it clears. `scanSessions: 0` disables the scan and the page keeps working.
- **A live Session is never cached.** Its log keeps growing, so `scanAll` skips ids the Session store reports as live.
- **Projection keys are read through a structural face.** `cachedSnapshot` accepts a closed projection-key union owned by other packages, so `StatsHost` in `src/index.ts` restates the two methods this plugin uses. Adding a projection read means extending that declaration, not importing another package.
- **Prices are an assumption with a named basis.** Every model row carries `basis` (`config`, a provider id, `deepseek`, or `median`), and `prices` overrides all of them. Never hardcode a rate in the page.
- **Charts use theme tokens only.** Series colours come from `--dsw-alias-brand-primary`, `-state-success-primary`, `-state-warn-primary`, `-button-info-fill`, `-state-idle-primary`, `-label-secondary`; surfaces and text from the alias tokens. No literal colours, no chart library.
- **Chart geometry stays pure and tested.** `chart.ts` and `format.ts` hold no React and no DOM, so `node:test` covers them; `page.ts` only composes them.
- **One panel id.** `PANEL_ID` keys both the `main` slot and the `sidebar.panellist` entry: the sidebar dispatches the entry id to the keyed main slot, so a mismatch would leave a button that opens nothing.

## Browser-Half Constraints

Same as [`../ui-custom/AGENTS.md`](../ui-custom/AGENTS.md): no JSX, no non-relative imports, services reached through `ctx` (declared in `dsh.client.inject` for ordering only), React handed in by the stamped envelope through `useReact`.

## Commands

```bash
pnpm --filter @d0nj/dsh-stats build      # tsc -p tsconfig.build.json && node scripts/stamp-client.mjs
pnpm --filter @d0nj/dsh-stats test       # pretest compile → dist-test/, then node --test
pnpm --filter @d0nj/dsh-stats typecheck
pnpm --filter @d0nj/dsh-stats check      # node --check over the emitted entry points
```

The client envelope cannot be exercised from Node; a UI change needs `pnpm build` and a page reload.

## Tests

`node:test` + `node:assert/strict` over `dist-test/`: `tokens.test.ts`, `pricing.test.ts`, `summary.test.ts`, `client/chart.test.ts`, `client/format.test.ts`. They cover the fold and the price-resolution rules, not wiring.

## Patch Config

`cordis.patch.yml` inserts one row, `id: stats`, with the catalog URL, TTL, `topSessions`, `scanSessions` and an empty `prices` map. The row id is the plugin identity; the only other contract between the halves is `ROUTE` in `src/index.ts` versus `ROUTE` in `src/client/page.ts`.

## Deps

Peers: `@deepseek-ai/cordis ~4.1.0`, `@deepseek-ai/schemastery ~3.19.0`, and the Harness packages whose services the Host half declares: `dsh-session-query`, `dsh-session-projection-cache`, `dsh-host-webserver` (mirrored in `devDependencies`). The client side needs no npm dependency: React comes from the loader, the other panels from `ctx`.
