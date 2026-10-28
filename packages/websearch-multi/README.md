# @d0nj/dsh-websearch-multi

Thirteen web-search backends and four page-fetch backends for the DeepSeek Harness `ctx.web` seam, so `web_search` and `web_fetch` keep one model-facing contract while the deployment picks the engine.

## Why

`web_search` talks only to `ctx.web`, which selects one registered provider. A deployment that wants a different engine — or a working engine when the first one's balance runs out — normally swaps packages. This bundle registers many backends at once and lets `web.searchProvider` / `web.fetchProvider` choose, so switching engines is a config edit rather than an install.

## Providers

| Id | Product | Auth | Answer | Notes |
|---|---|---|---|---|
| `tavily` | Tavily Search | `TAVILY_API_KEY` | yes | `max_results` is capped at 20 by the API |
| `exa` | Exa | `EXA_API_KEY` | no | has no snippet field; `highlights[]` is used as the snippet |
| `parallel` | Parallel | `PARALLEL_API_KEY` | no | single query goes in `search_queries[]`; count nests under `advanced_settings` |
| `tinyfish` | TinyFish Search | `TINYFISH_API_KEY` | no | GET, not POST; free up to a daily allowance |
| `firecrawl` | Firecrawl Search | optional `FIRECRAWL_API_KEY` | no | runs keyless from a residential address; a key raises the limit |
| `linkup` | Linkup | `LINKUP_API_KEY` | yes | title field is `name` |
| `brave` | Brave Search | `BRAVE_API_KEY` | no | sends `X-Subscription-Token`, not `Authorization` |
| `kagi` | Kagi Search | `KAGI_API_KEY` | no | paid only |
| `perplexity` | Perplexity Search | `PERPLEXITY_API_KEY` | no | results-only endpoint; the Sonar chat endpoint was retired 2026-09-27 |
| `serper` | Serper (Google SERP) | `SERPER_API_KEY` | knowledge graph | organic results use `link`, not `url` |
| `jina` | Jina Reader search | `JINA_API_KEY` | no | response is a bare top-level array |
| `searxng` | SearXNG | none | answerers | self-hosted; requires `baseURL`, and `format: json` enabled on the instance |
| `mojeek` | Mojeek | `MOJEEK_API_KEY` | no | key goes in the query string, not a header |

Fetch backends: `tavily` (extract), `exa` (contents), `firecrawl` (scrape), `jina` (Reader). `web_fetch` already has a safe local HTTP provider; these are opt-in for JavaScript-heavy pages, PDFs, or a deployment that already pays for an extractor.

## Install

```bash
pnpm install
pnpm --filter @d0nj/dsh-websearch-multi build
```

Then install the package directory into a profile with the `plugin_manager` tool.

## Configure

```yaml
- id: websearch-multi
  name: '@d0nj/dsh-websearch-multi'
  config:
    providers: [tavily, exa, parallel, tinyfish, firecrawl, linkup, brave, kagi, perplexity, serper, jina, searxng, mojeek]
    fetchProviders: []
    overrides:
      searxng:
        baseURL: https://searx.example.org
      firecrawl:
        tbs: qdr:w
        country: GB
```

Which provider answers is `web.searchProvider`, not the order of `providers`:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: tinyfish
    fetchProvider: http
```

Each backend resolves a credential reference that defaults to its conventional environment variable, so an exported `TAVILY_API_KEY` needs no config. Override the reference per provider, or set a literal key, with `overrides.<id>.apiKeyEnv` / `overrides.<id>.apiKey`.
## Combining providers

A combo registers as one provider that fans a query out to several backends and merges their results. It is selected like any other provider through `web.searchProvider`, so `web_search` needs no change.

```yaml
- id: websearch-multi
  name: '@d0nj/dsh-websearch-multi'
  config:
    providers: [tinyfish, tavily, exa, parallel, firecrawl]
    combos:
      - id: consensus
        members: [tinyfish, tavily, exa, parallel]
        merge: consensus
      - id: cheap
        members: [tinyfish, firecrawl, tavily]
        merge: append
        concurrent: false
        stopAfterResults: 8
      - id: shuffled
        members: [tinyfish, tavily, exa, brave]
        merge: random
```

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: consensus
```

| Field | Default | Meaning |
|---|---|---|
| `id` | required | Provider id the combo registers under; must not shadow a backend id |
| `label` | the id | Display name used in diagnostics |
| `members` | required | Backend ids to fan out to, in priority order |
| `merge` | `consensus` | How results are combined |
| `concurrent` | `true` | Query members in parallel; `false` queries in priority order and can stop early |
| `stopAfterResults` | none | With `concurrent: false`, stop once this many sources exist |
| `snippetBudget` | `600` | Characters kept per merged snippet when several backends describe one page |

### Merge strategies

- **`consensus`** ranks a page higher the more backends returned it, then by the better mean position. This is the default because agreement is the strongest relevance signal across engines that rank very differently.
- **`round-robin`** takes the best result of each backend in turn, then the next of each, so the first page represents every backend.
- **`append`** lists each backend whole, in configured priority order, for when the first backend's judgement is trusted most.
- **`random`** shuffles the deduplicated pool. The seed derives from the query, so replaying a turn cites the same pages rather than reshuffling history.

### What fusion actually does

Merging is mostly about agreement, not concatenation. Two engines return the same article as `https://example.com/a`, `http://www.example.com/a/`, `https://example.com/a#top`, and `https://example.com/a?utm_source=x`. Comparing raw strings makes those four separate sources and the model cites one page four times. The fusion normalizes scheme, `www.`/`amp.`/`m.` prefixes, mobile hosts (`old.reddit.com` → `reddit.com`), AMP path suffixes, trailing slashes, fragments, tracking parameters, and parameter order before comparing, then shows the cleanest spelling.

Snippets from every backend that returned the page are blended longest-first within `snippetBudget`, and the earliest publication date wins, since a news index and a general index should report the article's own date rather than the most recent crawl.

## Behavior worth knowing

- **A combo survives a member's outage.** If one member fails and others answer, the search succeeds with those; only when every member fails does the first error surface, unchanged and with its structured code.
- **A combo is also a fallback chain.** A member with no credential is skipped, so `members: [tinyfish, tavily]` answers through tavily when only that key is configured.
- **Registration follows configuration, not credentials.** A provider listed in `providers` is registered even when its key is missing, so the seam reports `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` naming that provider instead of a generic "no provider" error.
- **Keys are read per search**, so storing a key in the credentials service reaches the next call without a restart.
- **The seam owns the result cap.** Providers return what the API gave them; `ctx.web` truncates and flags `truncated`.
- **Failures are structured.** Missing credential is `WEB_PROVIDER_CREDENTIAL_MISSING` and names the reference to store; provider failures are `WEB_PROVIDER_ERROR` with the HTTP status and the provider's own message; cancellation is `WEB_ABORTED`.

## Tests

```bash
pnpm test
```

Adapters are tested offline against payloads recorded from each provider's documentation, the provider classes against a stubbed `fetch`, and fusion against URL spellings that engines genuinely disagree about. The suite needs no network and no API keys.
