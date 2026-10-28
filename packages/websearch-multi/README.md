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

## Behavior worth knowing

- **Registration follows configuration, not credentials.** A provider listed in `providers` is registered even when its key is missing, so the seam reports `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` naming that provider instead of a generic "no provider" error.
- **Keys are read per search**, so storing a key in the credentials service reaches the next call without a restart.
- **The seam owns the result cap.** Providers return what the API gave them; `ctx.web` truncates and flags `truncated`.
- **Failures are structured.** Missing credential is `WEB_PROVIDER_CREDENTIAL_MISSING` and names the reference to store; provider failures are `WEB_PROVIDER_ERROR` with the HTTP status and the provider's own message; cancellation is `WEB_ABORTED`.
- **Duplicates are dropped by URL**, so a provider that surfaces the same page from two indexes produces one source.

## Tests

```bash
pnpm test
```

Adapters are tested offline against payloads recorded from each provider's documentation, and the provider classes against a stubbed `fetch`, so the suite needs no network and no API keys.
