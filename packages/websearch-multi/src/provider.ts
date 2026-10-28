/**
 * Provider implementations handed to the `web` service.
 *
 * The seam calls `available()` before every operation and again when it selects
 * a provider, so it must be synchronous and must never touch the network. The
 * credential, by contrast, is resolved once per operation: that per-call read is
 * what lets a key written to the credential store reach the next search without
 * the flicker of re-registering a provider.
 *
 * @module @d0nj/dsh-websearch-multi/provider
 */
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'

import { FETCH_ADAPTERS } from './providers/fetch.js'
import { aborted, describe, providerError, requestJson, requestText, text } from './providers/http.js'
import { SEARCH_ADAPTERS } from './providers/search.js'
import type { FetchProviderId } from './providers/fetch.js'
import type { SearchProviderId } from './providers/search.js'
import type { AdapterFetchResult, AdapterSearchResult, FetchAdapter, SearchAdapter } from './providers/types.js'

/** Options one operation reads, snapshotted at its own entry. */
export interface ProviderOptions {
  /** Literal key from config; wins over {@link ProviderOptions.resolveApiKey}. */
  readonly apiKey: string | undefined
  /** Per-operation credential resolution through the credentials service. */
  readonly resolveApiKey: (() => Promise<string | undefined>) | undefined
  /** Credential reference named by missing-credential diagnostics. */
  readonly apiKeyEnv: string | undefined
  /** Endpoint override; the adapter default applies when absent. */
  readonly baseURL: string | undefined
  /** The live plugin config, for adapter-specific knobs. */
  readonly config: unknown
}

/** Supplies the options for the next operation. */
export type OptionsSource = () => ProviderOptions

/**
 * Resolve the endpoint an adapter will use, or report that it needs one.
 * @param adapter - the adapter.
 * @param options - the operation's options.
 * @returns the endpoint base, or `undefined` when none is configured.
 */
function resolveBaseURL(adapter: SearchAdapter | FetchAdapter, options: ProviderOptions): string | undefined {
  const baseURL = options.baseURL ?? adapter.defaultBaseURL
  return baseURL !== undefined && URL.canParse(baseURL) ? baseURL : undefined
}

/**
 * Build the error for a provider whose endpoint is not configured. Only
 * SearXNG reaches this path, because it has no default instance.
 * @param adapter - the adapter needing an endpoint.
 * @param id - provider id written in the fix.
 * @returns the error to throw.
 */
function missingBaseURL(adapter: SearchAdapter | FetchAdapter, id: string): Error {
  return providerError(
    `${adapter.label} needs a base URL: set websearch-multi.providers.${id}.baseURL to your instance (for example https://searx.example.org)`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}

/**
 * Build the error for a provider with no usable credential, naming both ways to
 * supply one so the model can tell the user exactly what to store.
 * @param adapter - the adapter needing the key.
 * @param id - provider id written in the fix.
 * @param apiKeyEnv - the reference that was checked, when one was.
 * @returns the error to throw.
 */
function missingCredential(adapter: SearchAdapter | FetchAdapter, id: string, apiKeyEnv: string | undefined): Error {
  const reference = apiKeyEnv ?? adapter.env
  return providerError(
    `${adapter.label} has no API key: store ${reference} through the credentials service, export it in the launching environment, or set websearch-multi.providers.${id}.apiKey. See ${adapter.docs}`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}

/**
 * Resolve one operation's credential without retaining it.
 * @param adapter - the adapter being prepared.
 * @param id - provider id, for the diagnostic.
 * @param options - the operation's options.
 * @param signal - caller cancellation.
 * @returns the key, or `undefined` when the adapter accepts none.
 * @throws {WebError} `WEB_ABORTED`, `WEB_PROVIDER_ERROR`, `WEB_PROVIDER_CREDENTIAL_MISSING`.
 */
async function resolveCredential(
  adapter: SearchAdapter | FetchAdapter,
  id: string,
  options: ProviderOptions,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (options.apiKey !== undefined) return options.apiKey
  if (options.resolveApiKey === undefined) {
    if (adapter.optionalKey === true) return undefined
    throw missingCredential(adapter, id, options.apiKeyEnv)
  }
  let resolved: string | undefined
  try {
    resolved = await options.resolveApiKey()
  } catch (error) {
    if (signal?.aborted === true) throw aborted(adapter.label, signal)
    throw providerError(
      `${adapter.label} credential resolution failed: ${describe(error)}`,
      'WEB_PROVIDER_ERROR',
      error,
    )
  }
  if (signal?.aborted === true) throw aborted(adapter.label, signal)
  const key = text(resolved)
  if (key === undefined) {
    if (adapter.optionalKey === true) return undefined
    throw missingCredential(adapter, id, options.apiKeyEnv)
  }
  return key
}

/**
 * One search backend registered with the web seam.
 *
 * @implements {WebSearchProvider}
 */
export class MultiSearchProvider implements WebSearchProvider {
  /** Provider id the seam selects by. */
  readonly id: SearchProviderId

  readonly #resolveOptions: OptionsSource
  readonly #adapter: SearchAdapter

  /**
   * @param id - provider id from the search catalog.
   * @param resolveOptions - supplies the options for the next operation.
   */
  constructor(id: SearchProviderId, resolveOptions: OptionsSource) {
    this.id = id
    this.#resolveOptions = resolveOptions
    this.#adapter = SEARCH_ADAPTERS[id]
  }

  /** The adapter's human label, for diagnostics. */
  get label(): string {
    return this.#adapter.label
  }

  /**
   * Whether a search could start right now. A keyless provider needs only a
   * usable endpoint; a keyed one additionally needs a literal key or a resolver.
   * @returns whether the seam should consider this provider usable.
   */
  available(): boolean {
    const options = this.#resolveOptions()
    if (resolveBaseURL(this.#adapter, options) === undefined) return false
    if (this.#adapter.keyless === true || this.#adapter.optionalKey === true) return true
    return options.apiKey !== undefined || options.resolveApiKey !== undefined
  }

  /**
   * Run one search through the provider.
   * @param request - the query and the caller's result bound.
   * @param signal - caller cancellation.
   * @returns the provider's sources and its answer, when it has one.
   * @throws {WebError} when the credential or endpoint is missing, the provider
   *   fails, or the caller cancels.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.#resolveOptions()
    const adapter = this.#adapter
    const baseURL = resolveBaseURL(adapter, options)
    if (baseURL === undefined) throw missingBaseURL(adapter, this.id)
    const apiKey = await resolveCredential(adapter, this.id, options, signal)
    const http = adapter.request(
      { apiKey, baseURL, config: options.config },
      { query: request.query, maxResults: request.maxResults },
    )
    const mapped: AdapterSearchResult = adapter.map(await requestJson(adapter.label, http, signal))
    return {
      ...(mapped.answer === undefined || mapped.answer.length === 0 ? {} : { content: mapped.answer }),
      // `sourcesFrom` already produces the seam's own source shape, so the list
      // needs no second projection here.
      sources: mapped.sources,
      // The seam owns the result cap: it truncates and flags, so the provider
      // never reports truncation on its own.
      truncated: false,
    }
  }
}

/**
 * One fetch backend registered with the web seam.
 *
 * @implements {WebFetchProvider}
 */
export class MultiFetchProvider implements WebFetchProvider {
  /** Provider id the seam selects by. */
  readonly id: FetchProviderId

  readonly #resolveOptions: OptionsSource
  readonly #adapter: FetchAdapter

  /**
   * @param id - provider id from the fetch catalog.
   * @param resolveOptions - supplies the options for the next operation.
   */
  constructor(id: FetchProviderId, resolveOptions: OptionsSource) {
    this.id = id
    this.#resolveOptions = resolveOptions
    this.#adapter = FETCH_ADAPTERS[id]
  }

  /** The adapter's human label, for diagnostics. */
  get label(): string {
    return this.#adapter.label
  }

  /**
   * @returns whether the seam should consider this provider usable.
   */
  available(): boolean {
    const options = this.#resolveOptions()
    if (resolveBaseURL(this.#adapter, options) === undefined) return false
    if (this.#adapter.optionalKey === true) return true
    return options.apiKey !== undefined || options.resolveApiKey !== undefined
  }

  /**
   * Retrieve one URL through the provider.
   * @param request - the URL to retrieve.
   * @param signal - caller cancellation.
   * @returns the decoded page, keeping the resource's own status code.
   * @throws {WebError} when the credential or endpoint is missing, the provider
   *   fails, or the caller cancels.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const options = this.#resolveOptions()
    const adapter = this.#adapter
    const baseURL = resolveBaseURL(adapter, options)
    if (baseURL === undefined) throw missingBaseURL(adapter, this.id)
    const apiKey = await resolveCredential(adapter, this.id, options, signal)
    const http = adapter.request({ apiKey, baseURL, config: options.config }, { url: request.url })
    const mapped: AdapterFetchResult =
      adapter.mapText !== undefined
        ? await requestText(adapter.label, http, signal).then(({ body, statusCode }) =>
            adapter.mapText === undefined ? undefined : adapter.mapText(body, statusCode, request.url),
          ) as AdapterFetchResult
        : adapter.map === undefined
          ? (() => {
              throw providerError(`${adapter.label} has no response mapping`, 'WEB_PROVIDER_ERROR')
            })()
          : adapter.map(await requestJson(adapter.label, http, signal), request.url)
    return mapped
  }
}
