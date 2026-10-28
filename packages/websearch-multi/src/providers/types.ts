/**
 * Shared vocabulary for the provider adapters.
 *
 * An adapter is a declarative pair: {@link SearchAdapter.request} builds one
 * HTTP request from a seam request, and {@link SearchAdapter.map} normalizes the
 * provider's JSON into the seam's result shape. Keeping both halves pure is what
 * lets the whole matrix be tested offline against recorded payloads, without a
 * network or an API key.
 *
 * @module @d0nj/dsh-websearch-multi/providers/types
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/** Headers a provider request carries. */
export type HttpHeaders = Record<string, string>

/** One outbound HTTP request, before a cancellation signal is attached. */
export interface HttpRequest {
  /** Absolute request URL. */
  readonly url: string
  /** `fetch` options, without `signal`. */
  readonly init: {
    readonly method: 'GET' | 'POST'
    readonly headers: HttpHeaders
    readonly body?: string
  }
}

/**
 * Everything an adapter needs to build a request.
 *
 * `baseURL` is always resolved (the adapter's default when the user set none),
 * so an adapter never has to decide what its own absence means.
 */
export interface SearchRequestContext {
  /** Resolved API key, or `undefined` for a keyless or key-optional provider. */
  readonly apiKey: string | undefined
  /** Resolved endpoint base, without a trailing slash. */
  readonly baseURL: string
  /** The live plugin config, for adapter-specific knobs such as Firecrawl's `tbs`. */
  readonly config: unknown
}

/** What one provider search produced, before the seam applies its result cap. */
export interface AdapterSearchResult {
  /** Provider-generated answer or summary, when the provider has one. */
  readonly answer?: string | undefined
  /** Citeable sources in the provider's rank order, deduplicated by URL. */
  readonly sources: readonly WebSearchSource[]
}

/** A search backend's declared behavior. */
export interface SearchAdapter {
  /** Human label used in model-facing error messages. */
  readonly label: string
  /** Conventional credential reference, also the settings default. */
  readonly env: string
  /** Default endpoint; absent when the endpoint must be configured (SearXNG). */
  readonly defaultBaseURL: string | undefined
  /** Official documentation URL cited in credential errors. */
  readonly docs: string
  /** True when the provider needs no credential at all. */
  readonly keyless?: true
  /** True when the provider runs without a key but accepts one to raise limits. */
  readonly optionalKey?: true
  /** Build the request for one query. */
  request(context: SearchRequestContext, request: { readonly query: string; readonly maxResults?: number | undefined }): HttpRequest
  /** Normalize the provider's parsed JSON body. */
  map(json: unknown): AdapterSearchResult
}

/** What one fetch produced. */
export interface AdapterFetchResult {
  readonly url: string
  readonly statusCode: number
  readonly body: { readonly kind: 'text'; readonly content: string }
  readonly truncated: boolean
}

/** A fetch backend's declared behavior. */
export interface FetchAdapter {
  readonly label: string
  readonly env: string
  readonly defaultBaseURL: string | undefined
  readonly docs: string
  readonly keyless?: true
  readonly optionalKey?: true
  /** Build the request for one URL. */
  request(context: SearchRequestContext, request: { readonly url: string }): HttpRequest
  /** Normalize a JSON response body into a decoded page. */
  map?(json: unknown, requestedURL: string): AdapterFetchResult
  /** Normalize a plain-text response (markdown backends) into a decoded page. */
  mapText?(body: string, statusCode: number, requestedURL: string): AdapterFetchResult
}
