/**
 * Adapter tests, run against recorded payloads with no network.
 *
 * Each case asserts the three things an adapter can get wrong and that only a
 * provider-shaped payload exposes: the request it sends (method, endpoint, auth
 * header, count field), the source fields it extracts, and how it handles the
 * variation the provider allows — absent titles, duplicate URLs, dated and
 * undated results.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { FETCH_ADAPTERS } from './providers/fetch.js'
import { SEARCH_ADAPTERS } from './providers/search.js'
import type { SearchAdapter } from './providers/types.js'
import * as fixtures from './fixtures.js'

/** Build a request for one adapter with a fixed key and endpoint. */
function build(adapter: SearchAdapter, query: string, maxResults?: number) {
  return adapter.request({ apiKey: 'test-key', baseURL: adapter.defaultBaseURL ?? 'https://searx.test', config: {} }, {
    query,
    ...(maxResults === undefined ? {} : { maxResults }),
  })
}

/** Parse a request's JSON body. */
function body(request: { init: { body?: string } }): Record<string, unknown> {
  assert.ok(request.init.body !== undefined, 'expected a JSON body')
  return JSON.parse(request.init.body) as Record<string, unknown>
}

describe('search adapters', () => {
  it('Tavily sends Bearer auth, clamps max_results, and reads the answer', () => {
    const request = build(SEARCH_ADAPTERS.tavily, 'messi', 50)
    assert.equal(request.init.method, 'POST')
    assert.equal(request.url, 'https://api.tavily.com/search')
    assert.equal(request.init.headers.authorization, 'Bearer test-key')
    // Tavily rejects max_results outside 0..20; a caller asking for 50 gets 20.
    assert.equal(body(request).max_results, 20)
    assert.equal(body(request).include_answer, 'basic')

    const mapped = SEARCH_ADAPTERS.tavily.map(fixtures.tavilySearch)
    assert.equal(mapped.answer, 'Lionel Messi is an Argentine footballer born in 1987.')
    // Four raw rows collapse to two: one duplicate URL and one row without a URL.
    assert.deepEqual(
      mapped.sources.map((source) => source.url),
      ['https://www.britannica.com/facts/Lionel-Messi', 'https://en.wikipedia.org/wiki/Lionel_Messi'],
    )
    assert.equal(mapped.sources[0]?.snippet?.startsWith('Lionel Messi, an Argentine'), true)
  })

  it('Exa uses x-api-key and falls back from highlights to summary', () => {
    const request = build(SEARCH_ADAPTERS.exa, 'test', 5)
    assert.equal(request.init.headers['x-api-key'], 'test-key')
    assert.equal(body(request).numResults, 5)
    assert.deepEqual(body(request).contents, { highlights: true })

    const mapped = SEARCH_ADAPTERS.exa.map(fixtures.exaSearch)
    assert.equal(mapped.answer, undefined)
    assert.equal(mapped.sources[0]?.snippet, 'Relevant snippet one.\n\nRelevant snippet two.')
    assert.equal(mapped.sources[0]?.publishedAt, '2024-01-15')
    assert.equal(mapped.sources[1]?.snippet, 'Falls back to the summary when no highlights came back.')
  })

  it('Parallel sends search_queries and nests max_results under advanced_settings', () => {
    const request = build(SEARCH_ADAPTERS.parallel, 'find things', 7)
    assert.equal(request.init.headers['x-api-key'], 'test-key')
    assert.deepEqual(body(request).search_queries, ['find things'])
    assert.deepEqual(body(request).advanced_settings, { max_results: 7 })

    const mapped = SEARCH_ADAPTERS.parallel.map(fixtures.parallelSearch)
    assert.equal(mapped.sources[0]?.snippet, 'Sample excerpt 1\n\nSample excerpt 2')
    // A nullable title stays absent rather than becoming the string "null".
    assert.equal(mapped.sources[1]?.title, undefined)
    assert.equal(mapped.sources[1]?.snippet, undefined)
  })

  it('TinyFish is a GET with X-API-Key and falls back to site_name', () => {
    const request = build(SEARCH_ADAPTERS.tinyfish, 'web automation')
    assert.equal(request.init.method, 'GET')
    assert.equal(request.init.body, undefined)
    assert.match(request.url, /^https:\/\/api\.search\.tinyfish\.ai\/\?query=web\+automation$/u)
    assert.equal(request.init.headers['x-api-key'], 'test-key')

    const mapped = SEARCH_ADAPTERS.tinyfish.map(fixtures.tinyfishSearch)
    assert.equal(mapped.sources[0]?.title, 'TinyFish — AI Web Automation Platform')
    assert.equal(mapped.sources[1]?.title, 'github.com')
    assert.equal(mapped.sources[0]?.publishedAt, '2026-05-01')
  })

  it('Firecrawl omits the auth header without a key and reports its failure envelope', () => {
    const anon = SEARCH_ADAPTERS.firecrawl.request(
      { apiKey: undefined, baseURL: 'https://api.firecrawl.dev/v2', config: {} },
      { query: 'x' },
    )
    assert.equal(anon.init.headers.authorization, undefined)
    assert.equal(body(anon).limit, 8)

    const mapped = SEARCH_ADAPTERS.firecrawl.map(fixtures.firecrawlSearch)
    assert.equal(mapped.sources[0]?.snippet, 'Latest advances in machine learning')
    // `description: null` falls through to the scraped markdown body.
    assert.equal(mapped.sources[1]?.snippet, 'Fallback body when the description is empty.')

    assert.throws(
      () => SEARCH_ADAPTERS.firecrawl.map(fixtures.firecrawlFailure),
      /Firecrawl search failed: Unfortunately/u,
    )
  })

  it('Linkup reads the answer plus sources and maps name to title', () => {
    const request = build(SEARCH_ADAPTERS.linkup, 'revenue', 4)
    assert.equal(body(request).q, 'revenue')
    assert.equal(body(request).outputType, 'sourcedAnswer')
    assert.equal(body(request).maxResults, 4)

    const mapped = SEARCH_ADAPTERS.linkup.map(fixtures.linkupSearch)
    assert.equal(mapped.answer, "Microsoft's 2024 revenue was $245.1 billion.")
    assert.equal(mapped.sources[0]?.title, 'Microsoft 2024 Annual Report')
  })

  it('Brave uses X-Subscription-Token, caps count, and reads web.results', () => {
    const request = build(SEARCH_ADAPTERS.brave, 'python', 50)
    assert.equal(request.init.headers['x-subscription-token'], 'test-key')
    assert.equal(request.init.headers.authorization, undefined)
    // Brave caps count at 20, and the clamp is applied before the request.
    assert.match(request.url, /[?&]count=20(?:&|$)/u)

    const mapped = SEARCH_ADAPTERS.brave.map(fixtures.braveSearch)
    assert.equal(mapped.sources.length, 2)
    assert.equal(mapped.sources[0]?.snippet, 'A comprehensive guide to Python web frameworks.')
    // With no description, the extra snippets become the snippet.
    assert.equal(mapped.sources[1]?.snippet, 'Only the extra snippets exist here.')
  })

  it('Kagi reads only the web arm of data', () => {
    const mapped = SEARCH_ADAPTERS.kagi.map(fixtures.kagiSearch)
    assert.equal(mapped.sources.length, 1)
    assert.equal(mapped.sources[0]?.title, 'A Kagi result')
    assert.equal(mapped.sources[0]?.snippet, 'The Kagi snippet.')
  })

  it('Perplexity maps a results-only response with no answer', () => {
    const request = build(SEARCH_ADAPTERS.perplexity, 'ai', 100)
    // Perplexity caps max_results at 20.
    assert.equal(body(request).max_results, 20)
    const mapped = SEARCH_ADAPTERS.perplexity.map(fixtures.perplexitySearch)
    assert.equal(mapped.answer, undefined)
    assert.equal(mapped.sources[0]?.publishedAt, '2026-04-02')
  })

  it('Serper maps link to url and promotes the knowledge graph to an answer', () => {
    const request = build(SEARCH_ADAPTERS.serper, 'google', 3)
    assert.equal(request.init.headers['x-api-key'], 'test-key')
    assert.equal(body(request).q, 'google')
    assert.equal(body(request).num, 3)

    const mapped = SEARCH_ADAPTERS.serper.map(fixtures.serperSearch)
    assert.equal(mapped.answer, 'A knowledge-graph description.')
    assert.equal(mapped.sources[0]?.url, 'https://en.wikipedia.org/wiki/Google_Search')
    assert.equal(mapped.sources[1]?.publishedAt, 'Mar 10, 2022')
  })

  it('Jina accepts the bare top-level array and sends num', () => {
    const request = build(SEARCH_ADAPTERS.jina, 'everest', 5)
    assert.equal(request.init.method, 'GET')
    assert.equal(request.init.headers['x-respond-with'], 'no-content')
    assert.match(request.url, /[?&]num=5(?:&|$)/u)

    const mapped = SEARCH_ADAPTERS.jina.map(fixtures.jinaSearch)
    assert.equal(mapped.sources.length, 1)
    assert.equal(mapped.sources[0]?.snippet, "Mount Everest is Earth's highest mountain above sea level.")
    assert.equal(mapped.sources[0]?.publishedAt, '2026-04-02T10:11:12.000Z')

    // A wrapper object must not silently yield an empty list.
    assert.equal(SEARCH_ADAPTERS.jina.map({ data: fixtures.jinaSearch }).sources.length, 1)
  })

  it('SearXNG joins its answerer output and needs no key', () => {
    const request = SEARCH_ADAPTERS.searxng.request(
      { apiKey: undefined, baseURL: 'https://searx.test', config: {} },
      { query: 'searxng' },
    )
    assert.match(request.url, /format=json/u)
    assert.equal(request.init.headers.authorization, undefined)

    const mapped = SEARCH_ADAPTERS.searxng.map(fixtures.searxngSearch)
    assert.equal(mapped.answer, 'An instant answer.')
    assert.equal(mapped.sources[0]?.title, 'SearXNG documentation')
  })

  it('Mojeek puts the key in the query string and reads response.results', () => {
    const request = build(SEARCH_ADAPTERS.mojeek, 'mojeek', 50)
    assert.match(request.url, /fmt=json/u)
    // Mojeek caps results per page at 10.
    assert.match(request.url, /[?&]t=10(?:&|$)/u)
    assert.match(request.url, /api_key=test-key/u)
    assert.equal(request.init.headers.authorization, undefined)

    const mapped = SEARCH_ADAPTERS.mojeek.map(fixtures.mojeekSearch)
    assert.equal(mapped.sources[0]?.snippet, 'The Mojeek description.')
  })

  it('every adapter tolerates an empty result set', () => {
    const emptyBodies: Record<string, unknown> = {
      tavily: {},
      exa: {},
      parallel: {},
      tinyfish: {},
      firecrawl: { success: true, data: {} },
      linkup: {},
      brave: {},
      kagi: {},
      perplexity: {},
      serper: {},
      jina: [],
      searxng: {},
      mojeek: {},
    }
    for (const id of Object.keys(SEARCH_ADAPTERS) as (keyof typeof SEARCH_ADAPTERS)[]) {
      const mapped = SEARCH_ADAPTERS[id].map(emptyBodies[id])
      assert.deepEqual(mapped.sources, [], `${id} should return no sources`)
      assert.equal(mapped.answer, undefined, `${id} should return no answer`)
    }
  })
})

describe('fetch adapters', () => {
  it('Tavily extract returns the raw content as text', () => {
    const result = FETCH_ADAPTERS.tavily.map?.(fixtures.tavilyExtract, 'https://example.com')
    assert.ok(result !== undefined)
    assert.equal(result.body.kind, 'text')
    assert.match(result.body.content, /Example Domain/u)
    assert.equal(result.statusCode, 200)
  })

  it('Tavily extract reports a per-URL failure', () => {
    assert.throws(
      () => FETCH_ADAPTERS.tavily.map?.(fixtures.tavilyExtractFailure, 'https://example.com'),
      /Tavily could not extract https:\/\/example\.com: site is down/u,
    )
  })

  it('Exa contents keeps the page status and converts a 404 into an error', () => {
    const result = FETCH_ADAPTERS.exa.map?.(fixtures.exaContents, 'https://example.com')
    assert.ok(result !== undefined)
    assert.match(result.body.content, /documentation examples/u)

    assert.throws(
      () =>
        FETCH_ADAPTERS.exa.map?.(
          { results: [{ url: 'https://example.com', statusCode: 404 }] },
          'https://example.com',
        ),
      /Exa could not retrieve https:\/\/example\.com \(HTTP 404\)/u,
    )
  })

  it('Firecrawl scrape returns markdown text', () => {
    const result = FETCH_ADAPTERS.firecrawl.map?.(fixtures.firecrawlScrape, 'https://example.com')
    assert.ok(result !== undefined)
    assert.equal(result.url, 'https://example.com')
    assert.match(result.body.content, /^# Example Domain/u)
  })

  it('Jina Reader maps a plain-text body and adds the key only when present', () => {
    const withKey = FETCH_ADAPTERS.jina.request(
      { apiKey: 'test-key', baseURL: 'https://r.jina.ai', config: {} },
      { url: 'https://example.com' },
    )
    assert.equal(withKey.url, 'https://r.jina.ai/https://example.com')
    assert.equal(withKey.init.headers.authorization, 'Bearer test-key')

    const withoutKey = FETCH_ADAPTERS.jina.request(
      { apiKey: undefined, baseURL: 'https://r.jina.ai', config: {} },
      { url: 'https://example.com' },
    )
    assert.equal(withoutKey.init.headers.authorization, undefined)

    const result = FETCH_ADAPTERS.jina.mapText?.(fixtures.jinaReader, 200, 'https://example.com')
    assert.ok(result !== undefined)
    assert.match(result.body.content, /documentation examples/u)
  })
})
