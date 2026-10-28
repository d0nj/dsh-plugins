/**
 * Value and HTTP helpers shared by every adapter.
 *
 * Providers disagree about how to spell "absent": the same field arrives as a
 * missing property, `null`, `''`, or a whitespace-only string, and dates arrive
 * as epoch numbers, ISO strings, or human phrases. These helpers collapse that
 * variation in one place so a response-shape difference between two providers
 * never becomes a difference in the model-facing result.
 *
 * @module @d0nj/dsh-websearch-multi/providers/http
 */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'

import type { HttpHeaders, HttpRequest } from './types.js'

/** Attribution header sent on every provider request. */
export const USER_AGENT = 'dsh-websearch-multi/1.0.0'

/** Bounded slice of a provider's error body kept in the message. */
const ERROR_DETAIL_CHARS = 400

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * Return a trimmed non-empty string, or `undefined` for anything else.
 * @param value - candidate field from a provider response.
 * @returns the trimmed string, or `undefined`.
 */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Return the first usable string among the candidates.
 * @param candidates - provider fields in preference order.
 * @returns the first usable string, or `undefined`.
 */
export function firstText(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    const found = text(candidate)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Join an excerpt array into one snippet. Parallel and Exa both return several
 * excerpts per result and have no single `snippet` field.
 * @param excerpts - excerpt strings from a provider response.
 * @returns the joined snippet, or `undefined` when nothing usable remains.
 */
export function joinExcerpts(excerpts: unknown): string | undefined {
  if (!Array.isArray(excerpts)) return undefined
  const parts = excerpts.map((excerpt) => text(excerpt)).filter((excerpt) => excerpt !== undefined)
  return parts.length === 0 ? undefined : parts.join('\n\n')
}

/**
 * Normalize a provider-supplied publication date to the ISO-8601 string the
 * seam types. Epoch numbers are the one non-string form worth converting;
 * everything else passes through, and an unparseable value is dropped rather
 * than invented.
 * @param value - candidate date field.
 * @returns the ISO string, or `undefined`.
 */
export function published(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return text(value)
}

/**
 * Read one own property from an unknown JSON value without a type assertion.
 * @param value - candidate container.
 * @param key - property name.
 * @returns the property value, or `undefined`.
 */
export function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

/**
 * Read a nested own property path from an unknown JSON value.
 * @param value - candidate container.
 * @param path - property names, outermost first.
 * @returns the value at the path, or `undefined` when any step is absent.
 */
export function path(value: unknown, ...keys: readonly string[]): unknown {
  let current = value
  for (const key of keys) {
    current = field(current, key)
    if (current === undefined) return undefined
  }
  return current
}

/**
 * Read an array property, or an empty array when it is absent or not an array.
 * @param value - candidate container.
 * @param key - property name holding the array.
 * @returns the array, or `[]`.
 */
export function arrayAt(value: unknown, key: string): readonly unknown[] {
  const found = field(value, key)
  return Array.isArray(found) ? found : []
}

/**
 * Build the source list, dropping entries without a usable URL and collapsing
 * duplicate URLs in provider order, and dropping an optional field the adapter
 * left absent rather than materializing `undefined` for it.
 *
 * A provider that surfaces one URL from two of its own indexes must not make
 * the model read the same source twice, and a provider that returns a
 * malformed row must not fail the whole search.
 *
 * @param items - raw provider entries.
 * @param normalize - maps one raw entry to a candidate source.
 * @returns the deduplicated sources.
 */
export function sourcesFrom(
  items: readonly unknown[],
  normalize: (item: unknown) => {
    readonly url: string
    readonly title?: string | undefined
    readonly snippet?: string | undefined
    readonly publishedAt?: string | undefined
  },
): readonly WebSearchSource[] {
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const item of items) {
    const candidate = normalize(item)
    const url = text(candidate.url)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    // `WebSearchSource` declares these fields as optional-but-present, and the
    // package compiles with `exactOptionalPropertyTypes`, so an absent field
    // must be omitted rather than assigned `undefined`.
    sources.push({
      url,
      ...(candidate.title === undefined ? {} : { title: candidate.title }),
      ...(candidate.snippet === undefined ? {} : { snippet: candidate.snippet }),
      ...(candidate.publishedAt === undefined ? {} : { publishedAt: candidate.publishedAt }),
    })
  }
  return sources
}

// ---------------------------------------------------------------------------
// URLs and headers
// ---------------------------------------------------------------------------

/**
 * Build an absolute URL from a base, a path, and optional query parameters.
 * @param baseURL - provider base, with or without a trailing slash.
 * @param path - operation path beginning with `/`, or `/` for the base itself.
 * @param query - query parameters; `undefined` and empty values are dropped.
 * @returns the absolute URL.
 */
export function endpoint(
  baseURL: string,
  path: string,
  query: Readonly<Record<string, string | number | undefined>> = {},
): string {
  const trimmed = baseURL.replace(/\/+$/u, '')
  const url = new URL(path === '/' && trimmed.length === 0 ? '/' : `${trimmed}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * Compose the headers shared by every JSON provider request.
 * @param extra - provider-specific headers.
 * @returns the header map.
 */
export function jsonHeaders(extra: HttpHeaders): HttpHeaders {
  return { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT, ...extra }
}

/** The subset of `fetch` input this package sends. */
export type FetchInit = NonNullable<Parameters<typeof fetch>[1]>

/**
 * Convert an adapter request plus a signal into `fetch` input.
 * @param request - the adapter's request.
 * @param signal - caller cancellation.
 * @returns the `fetch` input.
 */
export function fetchInit(request: HttpRequest, signal: AbortSignal | undefined): FetchInit {
  return {
    method: request.init.method,
    headers: request.init.headers,
    ...(request.init.body === undefined ? {} : { body: request.init.body }),
    ...(signal === undefined ? {} : { signal }),
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The seam's open set of error codes, narrowed to the ones this package raises. */
export type WebErrorCode =
  | 'WEB_ABORTED'
  | 'WEB_PROVIDER_ERROR'
  | 'WEB_PROVIDER_CREDENTIAL_MISSING'
  | 'WEB_PROVIDER_UNAVAILABLE'

/**
 * Build a provider error with its routable code and chained cause.
 * @param message - model-facing message naming the provider and the fix.
 * @param code - the seam code.
 * @param cause - underlying failure, when there is one.
 * @returns the error to throw.
 */
export function providerError(message: string, code: WebErrorCode, cause?: unknown): WebError {
  return cause === undefined ? new WebError(message, code) : new WebError(message, code, { cause })
}

/**
 * Render a thrown value for a diagnostic message.
 * @param error - the thrown value.
 * @returns a one-line description.
 */
export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the cancellation error, retaining the caller's reason.
 * @param label - provider label for the message.
 * @param signal - the caller's signal.
 * @returns the error to throw.
 */
export function aborted(label: string, signal: AbortSignal | undefined): WebError {
  return providerError(`${label} search aborted`, 'WEB_ABORTED', signal?.reason)
}

/**
 * Whether the caller has cancelled.
 *
 * A plain `signal?.aborted === true` is not enough: TypeScript narrows an
 * `AbortSignal` to "not yet aborted" after the first such guard in a function,
 * which makes every later abort check look unreachable — and that check really
 * is reachable, because the signal can abort while a request is in flight. This
 * helper takes `unknown` so each call site gets a fresh, unnarrowed check.
 *
 * @param signal - the caller's signal, if any.
 * @returns true when the caller has cancelled.
 */
export function cancelled(signal: unknown): boolean {
  return typeof signal === 'object' && signal !== null && (signal as { aborted?: unknown }).aborted === true
}

/**
 * Execute one provider request and parse its JSON body.
 *
 * A non-2xx response is always an error here: unlike `web_fetch`, a failed
 * search has no partial resource to describe, so the model needs the status and
 * the provider's own diagnostic instead of an empty result list.
 *
 * @param label - provider label used in messages.
 * @param request - the adapter's request.
 * @param signal - caller cancellation.
 * @returns the parsed JSON body.
 * @throws {WebError} `WEB_ABORTED` or `WEB_PROVIDER_ERROR`.
 */
export async function requestJson(
  label: string,
  request: HttpRequest,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const bodyText = await requestBody(label, request, signal)
  try {
    return JSON.parse(bodyText) as unknown
  } catch (error) {
    throw providerError(`${label} returned an unprocessable response body`, 'WEB_PROVIDER_ERROR', error)
  }
}

/**
 * Execute one provider request and return its text body.
 * @param label - provider label used in messages.
 * @param request - the adapter's request.
 * @param signal - caller cancellation.
 * @returns the response body and status code.
 * @throws {WebError} `WEB_ABORTED` or `WEB_PROVIDER_ERROR`.
 */
export async function requestText(
  label: string,
  request: HttpRequest,
  signal: AbortSignal | undefined,
): Promise<{ readonly body: string; readonly statusCode: number }> {
  const response = await dispatch(label, request, signal)
  const body = await readBody(label, response, signal)
  if (!response.ok) throw httpError(label, response.status, body)
  return { body, statusCode: response.status }
}

/**
 * Execute one provider request and return the body of a successful response.
 * @param label - provider label used in messages.
 * @param request - the adapter's request.
 * @param signal - caller cancellation.
 * @returns the response body.
 * @throws {WebError} `WEB_ABORTED` or `WEB_PROVIDER_ERROR`.
 */
async function requestBody(
  label: string,
  request: HttpRequest,
  signal: AbortSignal | undefined,
): Promise<string> {
  const response = await dispatch(label, request, signal)
  const body = await readBody(label, response, signal)
  if (!response.ok) throw httpError(label, response.status, body)
  return body
}

/**
 * Perform the network call, mapping transport failures and cancellation.
 * @param label - provider label used in messages.
 * @param request - the adapter's request.
 * @param signal - caller cancellation.
 * @returns the response.
 * @throws {WebError} `WEB_ABORTED` or `WEB_PROVIDER_ERROR`.
 */
async function dispatch(
  label: string,
  request: HttpRequest,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (cancelled(signal)) throw aborted(label, signal)
  try {
    return await fetch(request.url, fetchInit(request, signal))
  } catch (error) {
    // `signal.aborted` is read again rather than compared to a boolean literal:
    // an `AbortSignal` narrows to `false` after the guard above, which makes a
    // second `=== true` look impossible to the checker even though the signal
    // can abort while the request is in flight.
    if (cancelled(signal)) throw aborted(label, signal)
    throw providerError(`${label} request failed: ${describe(error)}`, 'WEB_PROVIDER_ERROR', error)
  }
}

/**
 * Read a response body, mapping read failures and cancellation.
 * @param label - provider label used in messages.
 * @param response - the response.
 * @param signal - caller cancellation.
 * @returns the body text.
 * @throws {WebError} `WEB_ABORTED` or `WEB_PROVIDER_ERROR`.
 */
async function readBody(
  label: string,
  response: Response,
  signal: AbortSignal | undefined,
): Promise<string> {
  try {
    return await response.text()
  } catch (error) {
    if (cancelled(signal)) throw aborted(label, signal)
    throw providerError(`${label} response could not be read: ${describe(error)}`, 'WEB_PROVIDER_ERROR', error)
  }
}

/**
 * Build the error for a non-2xx provider response.
 * @param label - provider label used in messages.
 * @param status - HTTP status code.
 * @param body - response body, used for its diagnostic.
 * @returns the error to throw.
 */
function httpError(label: string, status: number, body: string): WebError {
  const detail = body.trim().slice(0, ERROR_DETAIL_CHARS)
  return providerError(
    `${label} returned HTTP ${status}${detail.length === 0 ? '' : `: ${detail}`}`,
    'WEB_PROVIDER_ERROR',
  )
}

/**
 * Serialize a request body.
 * @param body - JSON-serializable body.
 * @returns the serialized body.
 */
export function jsonBody(body: unknown): string {
  return JSON.stringify(body)
}
