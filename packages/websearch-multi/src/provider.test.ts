/**
 * Provider and registration tests.
 *
 * These cover the behavior a payload fixture cannot: when a provider counts as
 * available, which error a missing credential produces, that a cancellation is
 * reported as such, and that registering the whole catalog does not break the
 * seam's own selection rules.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MultiFetchProvider, MultiSearchProvider } from './provider.js'
import type { ProviderOptions } from './provider.js'
import { fetchInit } from './providers/http.js'

/** An options value with no credential at all. */
function options(overrides: Partial<ProviderOptions> = {}): ProviderOptions {
  return {
    apiKey: undefined,
    resolveApiKey: undefined,
    apiKeyEnv: undefined,
    baseURL: undefined,
    config: {},
    ...overrides,
  }
}

/** Replace `fetch` for one test and restore it afterwards. */
function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

/** Build a JSON response. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('MultiSearchProvider.available', () => {
  it('is false for a keyed provider with no key at all', () => {
    const provider = new MultiSearchProvider('tavily', () => options())
    assert.equal(provider.available(), false)
  })

  it('is true for a keyed provider with a literal key', () => {
    const provider = new MultiSearchProvider('tavily', () => options({ apiKey: 'k' }))
    assert.equal(provider.available(), true)
  })

  it('is true while only a resolver exists, since the key is read per call', () => {
    const provider = new MultiSearchProvider('tavily', () => options({ resolveApiKey: async () => 'k' }))
    assert.equal(provider.available(), true)
  })

  it('is true for a key-optional provider with no key', () => {
    assert.equal(new MultiSearchProvider('firecrawl', () => options()).available(), true)
  })

  it('is false for a keyless provider whose endpoint is unconfigured', () => {
    // SearXNG has no default endpoint, so registration alone cannot make it usable.
    assert.equal(new MultiSearchProvider('searxng', () => options()).available(), false)
    assert.equal(
      new MultiSearchProvider('searxng', () => options({ baseURL: 'https://searx.example.org' })).available(),
      true,
    )
  })

  it('is false for an endpoint that does not parse', () => {
    const provider = new MultiSearchProvider('tavily', () => options({ apiKey: 'k', baseURL: 'not a url' }))
    assert.equal(provider.available(), false)
  })
})

describe('MultiSearchProvider.search', () => {
  it('reports a missing credential with its reference and the fix', async () => {
    const provider = new MultiSearchProvider('brave', () =>
      options({ resolveApiKey: async () => undefined, apiKeyEnv: 'BRAVE_API_KEY' }),
    )
    await assert.rejects(provider.search({ query: 'x' }), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { code?: unknown }).code, 'WEB_PROVIDER_CREDENTIAL_MISSING')
      assert.match(error.message, /store BRAVE_API_KEY/u)
      assert.match(error.message, /websearch-multi\.providers\.brave\.apiKey/u)
      return true
    })
  })

  it('falls back to the provider convention when no reference was configured', async () => {
    const provider = new MultiSearchProvider('brave', () => options({ resolveApiKey: async () => undefined }))
    await assert.rejects(provider.search({ query: 'x' }), /store BRAVE_API_KEY/u)
  })

  it('surfaces provider HTTP failures with the status and detail', async () => {
    const restore = stubFetch(async () => json({ error: { message: 'bad key' } }, 401))
    try {
      const provider = new MultiSearchProvider('tavily', () => options({ apiKey: 'k' }))
      await assert.rejects(provider.search({ query: 'x' }), /Tavily returned HTTP 401: .*bad key/u)
    } finally {
      restore()
    }
  })

  it('maps a provider payload into the seam result and leaves truncation to the seam', async () => {
    let seen: RequestInit | undefined
    const restore = stubFetch(async (_url, init) => {
      seen = init
      return json({
        results: [
          { url: 'https://a.example', title: 'A', content: 'snippet a' },
          { url: 'https://b.example', title: 'B' },
        ],
      })
    })
    try {
      const provider = new MultiSearchProvider('tavily', () => options({ apiKey: 'k' }))
      const result = await provider.search({ query: 'q', maxResults: 1 })
      assert.equal(result.sources.length, 2, 'the provider must not apply the cap itself')
      assert.equal(result.truncated, false)
      assert.equal(result.sources[0]?.title, 'A')
      assert.equal(seen?.method, 'POST')
    } finally {
      restore()
    }
  })

  it('omits an undefined answer instead of sending an empty one', async () => {
    const restore = stubFetch(async () => json({ results: [] }))
    try {
      const provider = new MultiSearchProvider('exa', () => options({ apiKey: 'k' }))
      const result = await provider.search({ query: 'q' })
      assert.equal(Object.hasOwn(result, 'content'), false)
      assert.deepEqual(result.sources, [])
    } finally {
      restore()
    }
  })

  it('reports an already-aborted call as WEB_ABORTED without calling out', async () => {
    let calls = 0
    const restore = stubFetch(async () => {
      calls += 1
      return json({})
    })
    try {
      const provider = new MultiSearchProvider('tavily', () => options({ apiKey: 'k' }))
      const controller = new AbortController()
      controller.abort(new Error('stop'))
      await assert.rejects(provider.search({ query: 'q' }, controller.signal), (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, 'WEB_ABORTED')
        return true
      })
      assert.equal(calls, 0)
    } finally {
      restore()
    }
  })

  it('names the endpoint when a keyless provider has none', async () => {
    const provider = new MultiSearchProvider('searxng', () => options())
    await assert.rejects(provider.search({ query: 'q' }), /SearXNG needs a base URL/u)
  })
})

describe('MultiFetchProvider', () => {
  it('requires a key for a keyed backend and accepts none for a key-optional one', () => {
    assert.equal(new MultiFetchProvider('tavily', () => options()).available(), false)
    assert.equal(new MultiFetchProvider('jina', () => options()).available(), true)
  })

  it('returns a decoded text body from a JSON backend', async () => {
    const restore = stubFetch(async () =>
      json({ results: [{ url: 'https://example.com', raw_content: 'hello' }] }),
    )
    try {
      const provider = new MultiFetchProvider('tavily', () => options({ apiKey: 'k' }))
      const result = await provider.fetch({ url: 'https://example.com' })
      assert.deepEqual(result.body, { kind: 'text', content: 'hello' })
    } finally {
      restore()
    }
  })

  it('returns a decoded text body from a plain-text backend', async () => {
    const restore = stubFetch(async () => new Response('markdown body', { status: 200 }))
    try {
      const provider = new MultiFetchProvider('jina', () => options())
      const result = await provider.fetch({ url: 'https://example.com' })
      assert.equal(result.body.content, 'markdown body')
      assert.equal(result.statusCode, 200)
    } finally {
      restore()
    }
  })
})

describe('fetchInit', () => {
  it('omits the body for a GET and forwards the signal', () => {
    const controller = new AbortController()
    const init = fetchInit(
      { url: 'https://example.com', init: { method: 'GET', headers: { accept: 'application/json' } } },
      controller.signal,
    )
    assert.equal(init.method, 'GET')
    assert.equal(init.body, undefined)
    assert.equal(init.signal, controller.signal)
  })
})
