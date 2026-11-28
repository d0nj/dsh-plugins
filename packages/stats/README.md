# @d0nj/dsh-stats

Token spend for the DeepSeek Harness: a **Token usage** page in the left sidebar that totals every stored Session and estimates what it cost.

## Why

The Harness records provider usage on every assistant message, but nothing shows the total across Sessions. This bundle reads the usage the Harness already folds into its projection cache, so it reports the full history without replaying a single Session log.

## What you get

- **Lifetime totals** split the way providers bill: uncached input, cache reads, cache writes and output. Cache reads dominate long agent Sessions, so they are counted apart from fresh input instead of lumped into one number.
- **Spend estimate** priced from the [models.dev](https://models.dev) catalog, per model and in total.
- **Token mix bar** showing how the whole spend divides across the four billed classes, with percentages.
- **Spend by model** donut plus a detail table: tokens, cost, the mix as a stacked bar, and the unit prices applied.
- **Spend by day** column chart over the last 30 days, with per-day cost in the tooltip.
- **Top sessions** with a relative bar, date, tokens and cost.
- A **Refresh** control; nothing is polled once the page is idle.

## Charts and where their numbers come from

The page is honest about the difference between the two data paths it uses:

| Figure | Source | Exactness |
|---|---|---|
| Lifetime token totals | The `tokenUsage` session projection, per Session | Exact to the last durable checkpoint (a live Session's unflushed tail can lag slightly) |
| Per-model tokens and cost | Replay of each Session's `assistant/message` usage, which carries the model that served the call | Exact for the Sessions replayed; the rest are attributed to their last-used model |
| Per-day cost and tokens | The `time` of each replayed assistant message | Exact for replayed Sessions; the rest count on their start day |
| Unit prices | models.dev listings, or your `prices` overrides | A pricing assumption, not a bill |

Replaying 700 logs would take too long for a page, so the Host replays the **largest `scanSessions` Sessions** (40 by default) in the background on first view. The page paints immediately from the projections — where a mixed-model Session would be billed entirely at its last model — and refreshes itself when the scan finishes. On this profile the top 40 Sessions carry over 99% of the spend, and the estimate moved from $80.09 to $128.54 when they were replayed exactly, which is why the distinction is worth the wait.

Scan results are kept for the life of the Host process, and a Session that is still live is never cached.

## Install

```bash
pnpm install
pnpm --filter @d0nj/dsh-stats build
```

Then install the package directory into a profile with the `plugin_manager` tool. The bundle patch inserts one row, `stats`.

A browser-half change needs `pnpm build` and a page reload; the Host half runs in-process, so a Host-side change needs a Harness restart.

## Configure

```yaml
- id: stats
  name: '@d0nj/dsh-stats'
  config:
    catalogUrl: https://models.dev/api.json
    catalogTtlMinutes: 360
    topSessions: 12
    scanSessions: 40
    prices:
      deepseek-v4.1-flash:
        input: 0.14
        cacheRead: 0.0042
        output: 0.42
        cacheWrite: 0.14
```

| Field | Default | Meaning |
|---|---|---|
| `catalogUrl` | `https://models.dev/api.json` | Price catalog. Any document with the same `provider → models → cost` shape works, including a local mirror. |
| `catalogTtlMinutes` | `360` | How long a fetched catalog stays usable. `0` refetches on every page load. |
| `topSessions` | `12` | How many Sessions the page lists individually (1–100). |
| `scanSessions` | `40` | How many of the largest Sessions to replay for exact per-model and per-day attribution (0–500). `0` turns the scan off and prices every Session at its last-used model. |
| `prices` | `{}` | Per-model overrides in USD per million tokens, keyed by model id or its last path segment. An override wins over every catalog listing. |

## How it works

The page is one fetch against `GET /d0nj-stats/summary`, a route the Host half registers while it is active. That route reads the `tokenUsage` projection of every listed Session from the projection cache (`ctx.sessionProjectionCache.cachedSnapshot`), plus the `modelSelection` and `title` projections, and prices the result.

Token counts therefore include every Session the profile has stored, including archived ones, and a page visit costs a few hundred cached-record views rather than a log replay. A Session that switched models between providers is priced at the model it last used, because the durable projections keep no per-call model history.

### How a price is chosen

Prices are USD per million tokens, and the same model is sold at very different rates, so resolution is explicit:

1. A `prices` override for that model id.
2. The catalog listing of the provider that served the call, when the catalog names it.
3. The official `deepseek` listing.
4. The median across every listing of that model.

The **Pricing** column names which rule applied (`config override`, `openrouter listing`, `DeepSeek listing`, `median of 93 listings`). Hovering a pricing cell shows the unit rates charged. Models with no listing are left unpriced: their tokens still count, and the footer says how many Sessions had no known rate.

Model ids are matched on their last path segment, so `meta/muse-spark-1.3` and `meta:muse-spark-1.3` both resolve through the same catalog entry.

## Limitations

- The route is **not authenticated**: DSH's web server owns no route policy, and the shipped bundle routes (`/plugins`, static assets) are public in the same way. It is safe on the default loopback bind; a Harness exposed to a network serves this aggregate to that network too.
- Spend is an **estimate**, not a bill. A router that bills differently from every public listing needs its own `prices` entry, and the median fallback is a defensible default rather than the truth.
- The background scan costs one pass of log replay the first time the page opens after a Host start (about ten seconds on a 700-Session profile, one Session at a time so the process stays responsive). `scanSessions: 0` avoids it entirely at the cost of per-model accuracy.
- Sessions the scan skips are attributed to the model they last used, so their model split and day chart are approximate. The page footer states how many Sessions carry call-level detail.
- Session titles come from the `title` projection; a Session that never got one shows its id.
- The page is English-only; the plugin inventory title and description are localized in `locale/en.json` and `locale/zh.json`.
