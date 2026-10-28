/**
 * The fetch backend catalog.
 *
 * `web_fetch` already has a safe local HTTP provider that blocks non-public
 * destinations and converts HTML with a real DOM. These backends exist for the
 * cases that provider cannot serve: a page behind JavaScript, a PDF, or a site
 * whose extractor a deployment already pays for. They are opt-in — a deployment
 * names them in `fetchProviders` and selects one with `web.fetchProvider` — and
 * they return markdown as text, so `web_fetch` renders them unchanged.
 *
 * @module @d0nj/dsh-websearch-multi/providers/fetch
 */
import {
  endpoint,
  field,
  firstText,
  jsonBody,
  jsonHeaders,
  path,
  providerError,
  text,
  USER_AGENT,
} from './http.js'
import type { FetchAdapter } from './types.js'

/**
 * Tavily extract: `POST /extract`. Returns `raw_content` per URL, and reports
 * per-URL failures under `failed_results` instead of failing the request.
 * @see https://docs.tavily.com/documentation/api-reference/endpoint/extract
 */
const tavily: FetchAdapter = {
  label: 'Tavily',
  env: 'TAVILY_API_KEY',
  defaultBaseURL: 'https://api.tavily.com',
  docs: 'https://docs.tavily.com/documentation/api-reference/endpoint/extract',
  request: ({ apiKey, baseURL }, { url }) => ({
    url: endpoint(baseURL, '/extract'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ authorization: `Bearer ${apiKey ?? ''}` }),
      body: jsonBody({ urls: [url], extract_depth: 'basic' }),
    },
  }),
  map: (json, requestedURL) => {
    const page = Array.isArray(field(json, 'results')) ? (field(json, 'results') as readonly unknown[])[0] : undefined
    if (page === undefined) {
      const failure = path(json, 'failed_results', '0', 'error')
      throw providerError(
        `Tavily could not extract ${requestedURL}${text(failure) === undefined ? '' : `: ${String(text(failure))}`}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    return {
      url: firstText(field(page, 'url'), requestedURL) ?? requestedURL,
      statusCode: 200,
      body: { kind: 'text', content: text(field(page, 'raw_content')) ?? '' },
      truncated: false,
    }
  },
}

/**
 * Exa contents: `POST /contents`. Fetches live page text for a small batch and
 * echoes the page's own status code, which the adapter turns into an error so a
 * 404 does not look like an empty page.
 * @see https://docs.exa.ai/reference/get-contents
 */
const exa: FetchAdapter = {
  label: 'Exa',
  env: 'EXA_API_KEY',
  defaultBaseURL: 'https://api.exa.ai',
  docs: 'https://docs.exa.ai/reference/get-contents',
  request: ({ apiKey, baseURL }, { url }) => ({
    url: endpoint(baseURL, '/contents'),
    init: {
      method: 'POST',
      headers: jsonHeaders({ 'x-api-key': apiKey ?? '' }),
      body: jsonBody({ ids: [url], text: { maxCharacters: 200000 } }),
    },
  }),
  map: (json, requestedURL) => {
    const page = Array.isArray(field(json, 'results')) ? (field(json, 'results') as readonly unknown[])[0] : undefined
    if (page === undefined) {
      throw providerError(`Exa returned no content for ${requestedURL}`, 'WEB_PROVIDER_ERROR')
    }
    const status = field(page, 'statusCode')
    const statusCode = typeof status === 'number' ? status : 200
    if (statusCode < 200 || statusCode >= 300) {
      throw providerError(`Exa could not retrieve ${requestedURL} (HTTP ${statusCode})`, 'WEB_PROVIDER_ERROR')
    }
    return {
      url: firstText(field(page, 'url'), requestedURL) ?? requestedURL,
      statusCode,
      body: { kind: 'text', content: text(field(page, 'text')) ?? '' },
      truncated: false,
    }
  },
}

/**
 * Firecrawl scrape: `POST /scrape` with markdown output. Key-optional on the
 * same terms as its search endpoint.
 * @see https://docs.firecrawl.dev/api-reference/endpoint/scrape
 */
const firecrawl: FetchAdapter = {
  label: 'Firecrawl',
  env: 'FIRECRAWL_API_KEY',
  defaultBaseURL: 'https://api.firecrawl.dev/v2',
  docs: 'https://docs.firecrawl.dev/api-reference/endpoint/scrape',
  optionalKey: true,
  request: ({ apiKey, baseURL }, { url }) => ({
    url: endpoint(baseURL, '/scrape'),
    init: {
      method: 'POST',
      headers: jsonHeaders(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      body: jsonBody({ url, formats: ['markdown'], onlyMainContent: true }),
    },
  }),
  map: (json, requestedURL) => {
    if (field(json, 'success') === false) {
      throw providerError(
        `Firecrawl could not scrape ${requestedURL}: ${firstText(field(json, 'error'), 'unknown error')}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    const status = path(json, 'data', 'metadata', 'statusCode')
    return {
      url: firstText(path(json, 'data', 'metadata', 'url'), requestedURL) ?? requestedURL,
      statusCode: typeof status === 'number' ? status : 200,
      body: { kind: 'text', content: text(path(json, 'data', 'markdown')) ?? '' },
      truncated: false,
    }
  },
}

/**
 * Jina Reader: `GET https://r.jina.ai/<url>` returns markdown as plain text, so
 * it has no JSON contract to normalize.
 * @see https://jina.ai/reader
 */
const jina: FetchAdapter = {
  label: 'Jina',
  env: 'JINA_API_KEY',
  defaultBaseURL: 'https://r.jina.ai',
  docs: 'https://jina.ai/reader',
  optionalKey: true,
  request: ({ apiKey, baseURL }, { url }) => ({
    url: `${baseURL.replace(/\/+$/u, '')}/${url}`,
    init: {
      method: 'GET',
      headers: {
        accept: 'text/plain',
        'x-return-format': 'markdown',
        'user-agent': USER_AGENT,
        ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      },
    },
  }),
  mapText: (body, statusCode, requestedURL) => ({
    url: requestedURL,
    statusCode,
    body: { kind: 'text', content: body },
    truncated: false,
  }),
}

/** Every fetch backend this bundle can register, keyed by provider id. */
export const FETCH_ADAPTERS = {
  tavily,
  exa,
  firecrawl,
  jina,
} as const satisfies Record<string, FetchAdapter>

/** A provider id this bundle serves as a fetch backend. */
export type FetchProviderId = keyof typeof FETCH_ADAPTERS

/** Every fetch provider id, in catalog order. */
export const FETCH_PROVIDER_IDS = Object.keys(FETCH_ADAPTERS) as readonly FetchProviderId[]

/**
 * Whether a string names a fetch backend this bundle serves.
 * @param id - candidate provider id.
 * @returns true when the catalog has the id.
 */
export function isFetchProviderId(id: string): id is FetchProviderId {
  return Object.hasOwn(FETCH_ADAPTERS, id)
}
