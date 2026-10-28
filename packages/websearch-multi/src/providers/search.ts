/**
 * The search backend catalog.
 *
 * One entry per provider id the `web` service can select through
 * `web.searchProvider`. Each entry documents the endpoint it speaks and the
 * documentation the request/response mapping was verified against, because the
 * providers disagree on nearly every detail: field names, result-count
 * parameters, auth headers, and whether a generated answer exists at all.
 *
 * @module @d0nj/dsh-websearch-multi/providers/search
 */
import {
  arrayAt,
  endpoint,
  field,
  firstText,
  joinExcerpts,
  jsonBody,
  jsonHeaders,
  path,
  providerError,
  published,
  sourcesFrom,
  text,
  USER_AGENT,
} from './http.js'
import type { SearchAdapter } from './types.js'

/** Read the Firecrawl knobs from the live config without assuming its shape. */
function firecrawlOptions(config: unknown): { tbs?: string; country?: string } {
  const tbs = text(path(config, 'providers_', 'firecrawl', 'tbs'))
  const country = text(path(config, 'providers_', 'firecrawl', 'country'))
  return { ...(tbs === undefined ? {} : { tbs }), ...(country === undefined ? {} : { country }) }
}

/**
 * Tavily: `POST /search`, Bearer. The only provider here whose answer flag
 * (`include_answer`) is on by default in this adapter, because Tavily's answer
 * is cheap and grounded in the same results it returns.
 * @see https://docs.tavily.com/documentation/api-reference/endpoint/search
 */
const tavily: SearchAdapter = {
  label: 'Tavily',
  env: 'TAVILY_API_KEY',
  defaultBaseURL: 'https://api.tavily.com',
  docs: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ authorization: `Bearer ${apiKey ?? ''}` }),
      body: jsonBody({
        query,
        // Tavily rejects a value outside 0..20, and `dsh-tool-web` asks for at
        // most 8 by default, so the clamp only matters for a raised cap.
        max_results: Math.min(maxResults ?? 8, 20),
        search_depth: 'basic',
        include_answer: 'basic',
      }),
    },
  }),
  map: (json) => ({
    answer: text(field(json, 'answer')),
    sources: sourcesFrom(arrayAt(json, 'results'), (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'title')),
      snippet: text(field(item, 'content')),
      publishedAt: published(field(item, 'published_date')),
    })),
  }),
}

/**
 * Exa: `POST /search`, `x-api-key`. Has no `snippet` field at all — the
 * query-relevant excerpts live in `highlights[]`, and `summary` is the fallback.
 * @see https://docs.exa.ai/reference/search
 */
const exa: SearchAdapter = {
  label: 'Exa',
  env: 'EXA_API_KEY',
  defaultBaseURL: 'https://api.exa.ai',
  docs: 'https://docs.exa.ai/reference/search',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ 'x-api-key': apiKey ?? '' }),
      body: jsonBody({
        query,
        numResults: maxResults ?? 8,
        contents: { highlights: true },
      }),
    },
  }),
  map: (json) => ({
    sources: sourcesFrom(arrayAt(json, 'results'), (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'title')),
      snippet: joinExcerpts(field(item, 'highlights')) ?? text(field(item, 'summary')),
      publishedAt: published(field(item, 'publishedDate')),
    })),
  }),
}

/**
 * Parallel: `POST /v1/search`, `x-api-key`. Takes keyword `search_queries`
 * plus an optional natural-language `objective`; one query per seam request
 * means the objective stays unset. The result bound lives under
 * `advanced_settings.max_results`, not at the top level.
 * @see https://docs.parallel.ai/api-reference/search/search
 */
const parallel: SearchAdapter = {
  label: 'Parallel',
  env: 'PARALLEL_API_KEY',
  defaultBaseURL: 'https://api.parallel.ai',
  docs: 'https://docs.parallel.ai/api-reference/search/search',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/v1/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ 'x-api-key': apiKey ?? '' }),
      body: jsonBody({
        search_queries: [query],
        mode: 'fast',
        ...(maxResults === undefined ? {} : { advanced_settings: { max_results: maxResults } }),
      }),
    },
  }),
  map: (json) => ({
    sources: sourcesFrom(arrayAt(json, 'results'), (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'title')),
      snippet: joinExcerpts(field(item, 'excerpts')),
      publishedAt: published(field(item, 'publish_date')),
    })),
  }),
}

/**
 * TinyFish: `GET /?query=`, `X-API-Key`. Free up to a daily allowance, then
 * billed; the adapter still requires a key rather than relying on the free tier,
 * so a keyless deployment gets an explicit credential error instead of a
 * surprise 429 on the allowance boundary.
 * @see https://docs.tinyfish.ai/search-api/reference
 */
const tinyfish: SearchAdapter = {
  label: 'TinyFish',
  env: 'TINYFISH_API_KEY',
  defaultBaseURL: 'https://api.search.tinyfish.ai',
  docs: 'https://docs.tinyfish.ai/search-api/reference',
  request: ({ apiKey, baseURL }, { query }) => ({
    url: endpoint(baseURL, '/', { query }),
    init: {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, 'x-api-key': apiKey ?? '' },
    },
  }),
  map: (json) => ({
    sources: sourcesFrom(arrayAt(json, 'results'), (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: firstText(field(item, 'title'), field(item, 'site_name')),
      snippet: text(field(item, 'snippet')),
      publishedAt: published(field(item, 'date')),
    })),
  }),
}

/**
 * Firecrawl: `POST /v2/search`. Runs without a key from a non-proxy address, so
 * the credential is optional; a key raises the rate limit and unlocks the free
 * monthly credits. `data.web[]` carries no date field, so web results arrive
 * undated by design.
 * @see https://docs.firecrawl.dev/api-reference/endpoint/search
 */
const firecrawl: SearchAdapter = {
  label: 'Firecrawl',
  env: 'FIRECRAWL_API_KEY',
  defaultBaseURL: 'https://api.firecrawl.dev/v2',
  docs: 'https://docs.firecrawl.dev/api-reference/endpoint/search',
  optionalKey: true,
  request: ({ apiKey, baseURL, config }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      body: jsonBody({
        query,
        limit: maxResults ?? 8,
        sources: [{ type: 'web' }],
        ...firecrawlOptions(config),
      }),
    },
  }),
  map: (json) => {
    if (field(json, 'success') === false) {
      throw providerError(
        `Firecrawl search failed: ${firstText(field(json, 'error'), 'unknown error')}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    return {
      sources: sourcesFrom(path(json, 'data', 'web') as readonly unknown[] | undefined ?? [], (item) => ({
        url: firstText(field(item, 'url')) ?? '',
        title: text(field(item, 'title')),
        snippet: firstText(field(item, 'description'), field(item, 'markdown')),
      })),
    }
  },
}

/**
 * Linkup: `POST /v1/search`, Bearer. `outputType: 'sourcedAnswer'` returns the
 * generated answer and the sources it cites in one call; the title field is
 * `name`, not `title`.
 * @see https://docs.linkup.so/pages/documentation/endpoints/search/reference
 */
const linkup: SearchAdapter = {
  label: 'Linkup',
  env: 'LINKUP_API_KEY',
  defaultBaseURL: 'https://api.linkup.so',
  docs: 'https://docs.linkup.so/pages/documentation/endpoints/search/reference',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/v1/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ authorization: `Bearer ${apiKey ?? ''}` }),
      body: jsonBody({
        q: query,
        depth: 'fast',
        outputType: 'sourcedAnswer',
        maxResults: maxResults ?? 8,
      }),
    },
  }),
  map: (json) => ({
    answer: text(field(json, 'answer')),
    sources: sourcesFrom(arrayAt(json, 'sources'), (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'name')),
      snippet: text(field(item, 'snippet')),
    })),
  }),
}

/**
 * Brave: `GET /res/v1/web/search`. The auth header is `X-Subscription-Token`,
 * not `Authorization` — the single most common Brave integration mistake — and
 * `count` is capped at 20 by the API.
 * @see https://api-dashboard.search.brave.com/api-reference/web/search/get
 */
const brave: SearchAdapter = {
  label: 'Brave',
  env: 'BRAVE_API_KEY',
  defaultBaseURL: 'https://api.search.brave.com',
  docs: 'https://api-dashboard.search.brave.com/api-reference/web/search/get',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/res/v1/web/search', {
      q: query,
      count: Math.min(maxResults ?? 8, 20),
    }),
    init: {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, 'x-subscription-token': apiKey ?? '' },
    },
  }),
  map: (json) => ({
    sources: sourcesFrom(path(json, 'web', 'results') as readonly unknown[] | undefined ?? [], (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'title')),
      snippet: firstText(field(item, 'description'), joinExcerpts(field(item, 'extra_snippets'))),
      publishedAt: published(field(item, 'page_age')),
    })),
  }),
}

/**
 * Kagi: `POST /api/v1/search`, Bearer. The results are split by type under
 * `data`; the web arm is `data.search`.
 * @see https://help.kagi.com/kagi/api/search.html
 */
const kagi: SearchAdapter = {
  label: 'Kagi',
  env: 'KAGI_API_KEY',
  defaultBaseURL: 'https://kagi.com',
  docs: 'https://help.kagi.com/kagi/api/search.html',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/api/v1/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ authorization: `Bearer ${apiKey ?? ''}` }),
      body: jsonBody({ query, limit: maxResults ?? 8 }),
    },
  }),
  map: (json) => ({
    sources: sourcesFrom(path(json, 'data', 'search') as readonly unknown[] | undefined ?? [], (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'title')),
      snippet: text(field(item, 'snippet')),
      publishedAt: published(field(item, 'time')),
    })),
  }),
}

/**
 * Perplexity: `POST /search`, Bearer, results only.
 *
 * The Sonar `/chat/completions` endpoint this provider was long known for was
 * retired on 2026-09-27, so the results endpoint is the stable target; the
 * answer variant is a different, separately billed API.
 * @see https://docs.perplexity.ai/api-reference/search-post
 */
const perplexity: SearchAdapter = {
  label: 'Perplexity',
  env: 'PERPLEXITY_API_KEY',
  defaultBaseURL: 'https://api.perplexity.ai',
  docs: 'https://docs.perplexity.ai/api-reference/search-post',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ authorization: `Bearer ${apiKey ?? ''}` }),
      body: jsonBody({ query, max_results: Math.min(maxResults ?? 8, 20) }),
    },
  }),
  map: (json) => ({
    sources: sourcesFrom(arrayAt(json, 'results'), (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'title')),
      snippet: text(field(item, 'snippet')),
      publishedAt: published(field(item, 'date')),
    })),
  }),
}

/**
 * Serper: `POST https://google.serper.dev/search`, `X-API-KEY`. Shapes a Google
 * SERP; `answerBox` and `knowledgeGraph` are its only answer-like fields, and
 * organic results carry `link` rather than `url`.
 * @see https://serper.dev
 */
const serper: SearchAdapter = {
  label: 'Serper',
  env: 'SERPER_API_KEY',
  defaultBaseURL: 'https://google.serper.dev',
  docs: 'https://serper.dev',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/search'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ 'x-api-key': apiKey ?? '' }),
      body: jsonBody({ q: query, num: Math.min(maxResults ?? 8, 100) }),
    },
  }),
  map: (json) => ({
    answer: firstText(
      path(json, 'answerBox', 'answer'),
      path(json, 'answerBox', 'snippet'),
      path(json, 'knowledgeGraph', 'description'),
    ),
    sources: sourcesFrom(arrayAt(json, 'organic'), (item) => ({
      url: firstText(field(item, 'link')) ?? '',
      title: text(field(item, 'title')),
      snippet: text(field(item, 'snippet')),
      publishedAt: published(field(item, 'date')),
    })),
  }),
}

/**
 * Jina: `GET https://s.jina.ai/?q=`, Bearer. The endpoint refuses keyless calls
 * with `401 AuthenticationRequiredError`, so unlike the Reader endpoint this one
 * always needs a key.
 *
 * Two details are easy to miss: with `Accept: application/json` the body is a
 * **bare top-level array**, not an object wrapping `data`, and `X-Respond-With:
 * no-content` suppresses the per-result page bodies, which otherwise make every
 * SERP request cost a fixed block of tokens on top of the search itself.
 * @see https://jina.ai/reader
 */
const jina: SearchAdapter = {
  label: 'Jina',
  env: 'JINA_API_KEY',
  defaultBaseURL: 'https://s.jina.ai',
  docs: 'https://jina.ai/reader',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/', {
      q: query,
      // The API validates `num` against 0..20.
      ...(maxResults === undefined ? {} : { num: Math.min(maxResults, 20) }),
    }),
    init: {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
        authorization: `Bearer ${apiKey ?? ''}`,
        'x-respond-with': 'no-content',
      },
    },
  }),
  map: (json) => {
    // Accept both the bare array the API documents and an object envelope, so a
    // future wrapper does not silently produce an empty result list.
    const results = Array.isArray(json) ? json : arrayAt(json, 'data')
    return {
      sources: sourcesFrom(results, (item) => ({
        url: firstText(field(item, 'url')) ?? '',
        title: text(field(item, 'title')),
        snippet: firstText(field(item, 'description'), field(item, 'content'))?.slice(0, 1200),
        publishedAt: published(field(item, 'date')),
      })),
    }
  },
}

/**
 * SearXNG: `GET /search?format=json`, no credential. Self-hosted, so there is no
 * default endpoint — a deployment must supply its instance URL. The instance's
 * `settings.yml` must enable the `json` format or it answers 403.
 * @see https://docs.searxng.org/dev/search_api.html
 */
const searxng: SearchAdapter = {
  label: 'SearXNG',
  env: 'SEARXNG_BASE_URL',
  defaultBaseURL: undefined,
  docs: 'https://docs.searxng.org/dev/search_api.html',
  keyless: true,
  request: ({ baseURL }, { query }) => ({
    url: endpoint(baseURL, '/search', { q: query, format: 'json' }),
    init: { method: 'GET', headers: { accept: 'application/json', 'user-agent': USER_AGENT } },
  }),
  map: (json) => {
    const answers = arrayAt(json, 'answers')
      .map((answer) => text(field(answer, 'answer')))
      .filter((answer): answer is string => answer !== undefined)
    return {
      answer: answers.length === 0 ? undefined : answers.join('\n\n'),
      sources: sourcesFrom(arrayAt(json, 'results'), (item) => ({
        url: firstText(field(item, 'url')) ?? '',
        title: text(field(item, 'title')),
        snippet: text(field(item, 'content')),
        publishedAt: published(field(item, 'publishedDate')),
      })),
    }
  },
}

/**
 * Mojeek: `GET https://api.mojeek.com/search`. The key travels as the `api_key`
 * query parameter rather than a header, and `fmt=json` is not the default
 * (`xml` is), so both are easy to get wrong.
 * @see https://www.mojeek.com/support/api/search/json_response.html
 */
const mojeek: SearchAdapter = {
  label: 'Mojeek',
  env: 'MOJEEK_API_KEY',
  defaultBaseURL: 'https://api.mojeek.com',
  docs: 'https://www.mojeek.com/support/api/search/json_response.html',
  request: ({ apiKey, baseURL }, { query, maxResults }) => ({
    url: endpoint(baseURL, '/search', {
      q: query,
      fmt: 'json',
      t: Math.min(maxResults ?? 8, 10),
      api_key: apiKey ?? '',
    }),
    init: { method: 'GET', headers: { accept: 'application/json', 'user-agent': USER_AGENT } },
  }),
  map: (json) => ({
    sources: sourcesFrom(path(json, 'response', 'results') as readonly unknown[] | undefined ?? [], (item) => ({
      url: firstText(field(item, 'url')) ?? '',
      title: text(field(item, 'title')),
      snippet: text(field(item, 'desc')),
      publishedAt: published(field(item, 'date')),
    })),
  }),
}

/** Every search backend this bundle can register, keyed by provider id. */
export const SEARCH_ADAPTERS = {
  tavily,
  exa,
  parallel,
  tinyfish,
  firecrawl,
  linkup,
  brave,
  kagi,
  perplexity,
  serper,
  jina,
  searxng,
  mojeek,
} as const satisfies Record<string, SearchAdapter>

/** A provider id this bundle serves as a search backend. */
export type SearchProviderId = keyof typeof SEARCH_ADAPTERS

/** Every search provider id, in catalog order. */
export const SEARCH_PROVIDER_IDS = Object.keys(SEARCH_ADAPTERS) as readonly SearchProviderId[]

/**
 * Whether a string names a search backend this bundle serves.
 * @param id - candidate provider id.
 * @returns true when the catalog has the id.
 */
export function isSearchProviderId(id: string): id is SearchProviderId {
  return Object.hasOwn(SEARCH_ADAPTERS, id)
}
