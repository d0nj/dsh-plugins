# Repository Guidelines — `@d0nj/dsh-websearch-multi`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Host-side Cordis bundle that fills the `ctx.web` capability seam: 13 search backends and 4 fetch backends, plus "combo" providers that fan one query out to several backends and fuse what comes back. Registered ids are selected by the Host config keys `web.searchProvider` / `web.fetchProvider`; registration order carries no priority.

## Architecture & Data Flow

```
apply()                          src/index.ts         register N backends + M combos on ctx.web
  → resolveOptions()             src/index.ts         override → adapter default → credential ref
  → MultiSearchProvider          src/provider.ts      available() / search() / fetch()
  → SearchAdapter | FetchAdapter src/providers/*.ts   request(ctx, req) → map(json) | mapText(body)
  → requestJson / requestText    src/providers/http.ts  fetch, non-2xx → WebError
  → CombinedSearchProvider       src/combined.ts      fan-out → fuseResults()
  → fuseResults                  src/fusion.ts        normalize → absorb → strategy → project
```

| File | Role | Key exports |
|---|---|---|
| `src/index.ts` | plugin entry, schemas, credential wiring, registration | `name`, `inject = ['web']`, `Config`, `apply`, `PluginConfig`, `ProviderOverrideValues`, `ComboValues` |
| `src/provider.ts` | seam adapters: availability, per-op credential resolution, request→map pipeline | `MultiSearchProvider`, `MultiFetchProvider`, `ProviderOptions`, `OptionsSource` |
| `src/combined.ts` | combo fan-out, failure policy, validation | `CombinedSearchProvider`, `ComboSpec`, `ProviderLookup`, `validateCombo`, `MERGE_STRATEGY_HELP`, `describeFailures` |
| `src/fusion.ts` | pure dedupe/merge, no I/O | `fuseResults`, `normalizeUrl`, `MergeStrategy`, `FuseOptions` |
| `src/providers/types.ts` | declarative adapter vocabulary | `SearchAdapter`, `FetchAdapter`, `SearchRequestContext`, `AdapterSearchResult`, `AdapterFetchResult`, `HttpRequest` |
| `src/providers/http.ts` | venue-neutral plumbing + error constructors | `providerError`, `WebErrorCode`, `aborted`, `cancelled`, `requestJson`, `requestText`, payload helpers |
| `src/providers/search.ts` | 13 search adapters + catalog | `SEARCH_ADAPTERS`, `SEARCH_PROVIDER_IDS`, `isSearchProviderId`, `SearchProviderId` |
| `src/providers/fetch.ts` | 4 fetch adapters + catalog | `FETCH_ADAPTERS`, `FETCH_PROVIDER_IDS`, `isFetchProviderId`, `FetchProviderId` |
| `src/fixtures.ts` | recorded provider payloads, docs-derived | excluded from `dist/` by `tsconfig.build.json` |
| `cordis.patch.yml` | registers all 13 backends + `consensus` / `cheap` / `shuffled` combos | must not override the `web` row |

### Invariants

- Providers register **even without credentials**. `available()` decides per call and must never touch the network.
- `available()` requires a parseable `baseURL` plus a key — unless the adapter is `keyless` or `optionalKey`.
- Every seam-visible failure is a `WebError` from `providerError(message, code, cause?)`; messages name the fix (which env var or base URL to set).
- A combo tolerates member outages and skips unavailable members (that is the fallback chain). It rethrows the first structured error **only** when every member fails.
- `validateCombo` is non-fatal: bad specs are logged (`logger.error('ignoring combo …')`) and skipped so a profile never fails to mount.
- Combos resolve members through the plugin-local `registered` map, so they only span backends this plugin registered.

### Fusion

`fuseResults` is pure. Keys are `normalizeUrl` output: tracking params dropped, params sorted, host prefix + canonical-host table, AMP suffix, trailing slash, scheme dropped, non-default port kept. Votes count once per backend per page. Strategies: `consensus` (votes desc, mean rank, first-seen), `round-robin` (mean rank — a sort, not literal interleaving), `append` (first-seen), `random` (`seededShuffle`, xorshift32 seeded from `seedFor(query)` via FNV-1a). Display URL = highest-scoring variant; snippets blend longest-first within `snippetBudget`; earliest date wins.

## Adding a Backend

1. Add an adapter object to `SEARCH_ADAPTERS` in `src/providers/search.ts` — `label`, `env`, `defaultBaseURL`, `docs`, optional `keyless`/`optionalKey`, `request(ctx, {query, maxResults})`, `map(json)`. Use `http.ts` helpers (`text`, `firstText`, `sourcesFrom`, `endpoint`, `jsonHeaders`, `path`, `arrayAt`) rather than hand-rolled coercion.
2. Ids flow automatically: `SEARCH_PROVIDER_IDS` and `isSearchProviderId` derive from the catalog, so the config schema, `index.ts` validation and error text pick it up.
3. Fetch adapters (`src/providers/fetch.ts`) use `map` for JSON or `mapText` for plain-text/markdown backends — never both.
4. Extend `src/adapters.test.ts` with the request shape and a payload → `sources`/`answer` case.
5. If the backend needs a config knob, read it through `SearchRequestContext.config` (untyped) — but prefer schema fields under `overrides.<id>`.

## Commands

```bash
pnpm --filter @d0nj/dsh-websearch-multi build        # tsc -p tsconfig.build.json → dist/
pnpm --filter @d0nj/dsh-websearch-multi test         # pretest compile + node --test
pnpm --filter @d0nj/dsh-websearch-multi typecheck
pnpm --filter @d0nj/dsh-websearch-multi check        # node --check dist/index.js dist/providers/{search,fetch}.js
cd packages/websearch-multi && node --test dist-test/fusion.test.js
node --test --test-name-pattern="consensus" "dist-test/**/*.test.js"
```

`check` lists emitted files by hand — a new entry module must be added to that script or it escapes the gate.

## Tests

`node:test` + `node:assert/strict`, offline, over `dist-test/`.

| File | Covers |
|---|---|
| `src/adapters.test.ts` | per-backend request shape + payload mapping; fetch failure envelopes |
| `src/provider.test.ts` | `available()` rules, credential errors, HTTP failure surfacing, `WEB_ABORTED` on pre-aborted signal, `fetchInit` |
| `src/fusion.test.ts` | `normalizeUrl`, `fuseResults` strategies/budget/seeding, `CombinedSearchProvider` partial + total failure, `validateCombo`, `MERGE_STRATEGY_HELP` |
| `src/fixtures.ts` | recorded payloads, imported as `import * as fixtures from './fixtures.js'` |

Patterns: `stubFetch(handler)` swaps `globalThis.fetch` and returns a restore fn called in `finally`; `json(body, status)` builds `Response`; stub providers implement `WebSearchProvider`; dependency injection through the constructor lookup, never module mocking. Keep payload expectations in `fixtures.ts` instead of inline literals.

## Patch Config

`cordis.patch.yml` ships `providers` (all 13), `fetchProviders: []`, and three combos. It deliberately does **not** override the `web` row: `web.searchProvider` / `web.fetchProvider` must be set by the profile patch, which outranks this file. Combo rows: `id`, `label`, `members`, `merge`, `concurrent`, `stopAfterResults` (serial only), `snippetBudget` (default 600).

## Deps

Peers (mirrored in `devDependencies` for types): `@deepseek-ai/cordis ~4.0.5`, `dsh-credentials` / `dsh-launch-environment` / `dsh-web` `0.2.1-rc.2`, `schemastery ~3.18.5`. No runtime third-party libraries — `fetch`/`URL`/`AbortSignal` only. Credentials resolve at call time via `ctx.get('credentials')`, falling back to `launchEnvironmentOf(ctx)`.
