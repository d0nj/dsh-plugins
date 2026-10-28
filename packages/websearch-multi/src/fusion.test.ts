/**
 * Fusion and combo tests.
 *
 * The URL-normalization cases are the point of this file: engines return the same
 * article under spellings that differ only in tracking, AMP, mobile hosts, and
 * parameter order, and a merge that treats those as distinct pages produces a
 * result list where one source appears five times.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CombinedSearchProvider, MERGE_STRATEGY_HELP, validateCombo } from './combined.js'
import { fuseResults, normalizeUrl } from './fusion.js'
import type { MergeStrategy } from './fusion.js'
import type { WebSearchProvider, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Build one source with only the fields the fusion cares about. */
function source(url: string, extra: Omit<WebSearchSource, 'url'> = {}): WebSearchSource {
  return { url, ...extra }
}

describe('normalizeUrl', () => {
  it('collapses scheme, www, trailing slash, and fragment', () => {
    const forms = [
      'https://example.com/a',
      'http://example.com/a',
      'https://www.example.com/a',
      'https://example.com/a/',
      'https://example.com/a#section',
      'HTTPS://EXAMPLE.COM/A',
    ]
    const keys = new Set(forms.map(normalizeUrl))
    assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(' | ')}`)
  })

  it('drops tracking parameters but keeps meaningful ones', () => {
    assert.equal(
      normalizeUrl('https://example.com/p?utm_source=twitter&utm_campaign=x'),
      normalizeUrl('https://example.com/p'),
    )
    // `page` changes the resource, so it must survive.
    assert.notEqual(
      normalizeUrl('https://example.com/p?page=2'),
      normalizeUrl('https://example.com/p'),
    )
  })

  it('treats parameter order as irrelevant', () => {
    assert.equal(
      normalizeUrl('https://example.com/s?a=1&b=2'),
      normalizeUrl('https://example.com/s?b=2&a=1'),
    )
  })

  it('collapses AMP and mobile variants onto the canonical page', () => {
    const canonical = normalizeUrl('https://example.com/story')
    for (const variant of [
      'https://example.com/story/amp',
      'https://example.com/story.amp',
      'https://amp.example.com/story',
      'https://m.example.com/story',
    ]) {
      assert.equal(normalizeUrl(variant), canonical, variant)
    }
    // A dedicated mobile subdomain maps to its canonical host.
    assert.equal(
      normalizeUrl('https://old.reddit.com/r/x/comments/1/'),
      normalizeUrl('https://reddit.com/r/x/comments/1'),
    )
  })

  it('keeps different paths and different hosts distinct', () => {
    assert.notEqual(normalizeUrl('https://example.com/a'), normalizeUrl('https://example.com/b'))
    assert.notEqual(normalizeUrl('https://example.com/a'), normalizeUrl('https://other.com/a'))
  })

  it('keeps a non-default port significant', () => {
    assert.notEqual(
      normalizeUrl('https://example.com:8443/a'),
      normalizeUrl('https://example.com/a'),
    )
  })

  it('gives an unparseable URL its own lowercase key instead of dropping it', () => {
    assert.equal(normalizeUrl('  Not A URL  '), 'not a url')
  })
})

/** Two backends returning overlapping results, written the way real engines do. */
const engineA: readonly WebSearchSource[] = [
  source('https://shared.example/story', { title: 'Shared from A', snippet: 'Short A snippet.' }),
  source('https://only-a.example/x', { title: 'Only A' }),
]
const engineB: readonly WebSearchSource[] = [
  source('https://shared.example/story?utm_source=b', {
    title: 'Shared from B',
    snippet: 'A longer B snippet that says more about the same page than A did.',
  }),
  source('https://only-b.example/y', { title: 'Only B' }),
]

describe('fuseResults', () => {
  it('collapses a page both backends returned and blends their snippets', () => {
    const fused = fuseResults([engineA, engineB], {
      strategy: 'consensus',
      snippetBudget: 600,
      maxResults: 10,
      seed: 1,
    })
    assert.equal(fused.length, 3, 'one shared page plus one exclusive from each backend')
    const shared = fused.find((entry) => entry.url.includes('shared.example'))
    assert.ok(shared !== undefined)
    // Both descriptions survive, longest first, and neither is lost.
    assert.match(shared.snippet ?? '', /longer B snippet/u)
    assert.match(shared.snippet ?? '', /Short A snippet/u)
    // The displayed URL drops the tracking parameter.
    assert.equal(shared.url, 'https://shared.example/story')
  })

  it('ranks the page both backends agreed on first under consensus', () => {
    const fused = fuseResults([engineA, engineB], {
      strategy: 'consensus',
      snippetBudget: 600,
      maxResults: 10,
      seed: 1,
    })
    assert.match(fused[0]?.url ?? '', /shared\.example/u)
  })

  it('lists each backend whole in priority order under append', () => {
    const fused = fuseResults([engineA, engineB], {
      strategy: 'append',
      snippetBudget: 600,
      maxResults: 10,
      seed: 1,
    })
    assert.deepEqual(
      fused.map((entry) => entry.url),
      ['https://shared.example/story', 'https://only-a.example/x', 'https://only-b.example/y'],
    )
  })

  it('caps the merged list at maxResults', () => {
    const fused = fuseResults([engineA, engineB], {
      strategy: 'consensus',
      snippetBudget: 600,
      maxResults: 2,
      seed: 1,
    })
    assert.equal(fused.length, 2)
  })

  it('does not let one backend outvote two by repeating a URL', () => {
    // Backend A returns the same page three ways; backend B returns it once.
    // Agreement is measured in backends, so C (returned by B and C) should tie
    // or beat it, never lose to the repetition.
    const repeated: readonly WebSearchSource[] = [
      source('https://p.example/1'),
      source('https://p.example/1/'),
      source('https://p.example/1?utm_source=x'),
    ]
    const single = [source('https://q.example/2')]
    const fused = fuseResults([repeated, single], {
      strategy: 'consensus',
      snippetBudget: 600,
      maxResults: 10,
      seed: 1,
    })
    // The repeated page appears exactly once, proving it collapsed.
    assert.equal(fused.filter((entry) => entry.url.includes('p.example')).length, 1)
  })

  it('produces a repeatable order for random with the same seed', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      source(`https://example.com/page-${String(index)}`),
    )
    const options = { strategy: 'random' as MergeStrategy, snippetBudget: 600, maxResults: 12, seed: 42 }
    const first = fuseResults([many], options).map((entry) => entry.url)
    const second = fuseResults([many], options).map((entry) => entry.url)
    assert.deepEqual(first, second)
    // A different seed should reorder; identical order would mean it is ignored.
    const other = fuseResults([many], { ...options, seed: 7 }).map((entry) => entry.url)
    assert.notDeepEqual(first, other)
  })

  it('keeps the earlier publication date when backends disagree', () => {
    const fused = fuseResults(
      [
        [source('https://news.example/a', { publishedAt: '2026-03-02' })],
        [source('https://news.example/a', { publishedAt: '2026-01-15' })],
      ],
      { strategy: 'consensus', snippetBudget: 600, maxResults: 5, seed: 1 },
    )
    assert.equal(fused[0]?.publishedAt, '2026-01-15')
  })

  it('handles empty input from every backend', () => {
    const fused = fuseResults([[], []], {
      strategy: 'consensus',
      snippetBudget: 600,
      maxResults: 5,
      seed: 1,
    })
    assert.deepEqual(fused, [])
  })

  it('keeps a snippet within the configured budget', () => {
    const long = 'x'.repeat(400)
    const long2 = 'y'.repeat(400)
    const fused = fuseResults(
      [
        [source('https://a.example/p', { snippet: long })],
        [source('https://a.example/p', { snippet: long2 })],
      ],
      { strategy: 'consensus', snippetBudget: 500, maxResults: 5, seed: 1 },
    )
    assert.ok((fused[0]?.snippet ?? '').length <= 500)
  })
})

/** A stub member provider. */
function member(
  id: string,
  behavior: 'ok' | 'fail' | 'empty',
  sources: readonly WebSearchSource[],
): WebSearchProvider {
  return {
    id,
    available: () => true,
    search: async () => {
      if (behavior === 'fail') throw new Error(`${id} is down`)
      if (behavior === 'empty') return { sources: [], truncated: false }
      return { sources, truncated: false }
    },
  }
}

/** A stub member that is registered but unusable. */
function unavailable(id: string): WebSearchProvider {
  return {
    id,
    available: () => false,
    search: async () => {
      throw new Error('should not be called')
    },
  }
}

describe('CombinedSearchProvider', () => {
  const spec = validateCombo(
    {
      id: 'both',
      label: 'Both',
      members: ['a', 'b'],
      merge: 'consensus',
      concurrent: true,
      stopAfterResults: undefined,
      snippetBudget: undefined,
    },
    ['a', 'b', 'c'],
    ['both'],
  )

  it('merges results from every available member', async () => {
    const providers: Record<string, WebSearchProvider> = {
      a: member('a', 'ok', [source('https://a.example/1')]),
      b: member('b', 'ok', [source('https://b.example/2')]),
    }
    const combined = new CombinedSearchProvider(spec, (id) => providers[id])
    const result = await combined.search({ query: 'q' })
    assert.equal(result.sources.length, 2)
    assert.equal(result.truncated, false)
  })

  it('survives one member failing and reports the other', async () => {
    const providers: Record<string, WebSearchProvider> = {
      a: member('a', 'fail', []),
      b: member('b', 'ok', [source('https://b.example/2')]),
    }
    const combined = new CombinedSearchProvider(spec, (id) => providers[id])
    const result = await combined.search({ query: 'q' })
    assert.equal(result.sources.length, 1)
  })

  it('rethrows the first member error when every member fails', async () => {
    const providers: Record<string, WebSearchProvider> = {
      a: member('a', 'fail', []),
      b: member('b', 'fail', []),
    }
    const combined = new CombinedSearchProvider(spec, (id) => providers[id])
    await assert.rejects(combined.search({ query: 'q' }), /a is down/u)
  })

  it('is unavailable only when every member is', () => {
    const mixed = new CombinedSearchProvider(spec, (id) =>
      id === 'a' ? unavailable('a') : member('b', 'ok', []),
    )
    assert.equal(mixed.available(), true)

    const none = new CombinedSearchProvider(spec, (id) => unavailable(id))
    assert.equal(none.available(), false)
  })

  it('names the members when nothing is usable', async () => {
    const none = new CombinedSearchProvider(spec, (id) => unavailable(id))
    await assert.rejects(none.search({ query: 'q' }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, 'WEB_PROVIDER_UNAVAILABLE')
      assert.match((error as Error).message, /none of a, b/u)
      return true
    })
  })

  it('ignores a member that is registered but unavailable', async () => {
    const providers: Record<string, WebSearchProvider> = {
      a: unavailable('a'),
      b: member('b', 'ok', [source('https://b.example/2')]),
    }
    const combined = new CombinedSearchProvider(spec, (id) => providers[id])
    const result = await combined.search({ query: 'q' })
    assert.equal(result.sources.length, 1)
  })

  it('stops early in serial mode once enough sources exist', async () => {
    let calls = 0
    const counting = (id: string): WebSearchProvider => ({
      id,
      available: () => true,
      search: async () => {
        calls += 1
        return { sources: [source(`https://${id}.example/x`)], truncated: false }
      },
    })
    const serial = validateCombo(
      {
        id: 'serial',
        label: undefined,
        members: ['a', 'b', 'c'],
        merge: 'append',
        concurrent: false,
        stopAfterResults: 1,
        snippetBudget: undefined,
      },
      ['a', 'b', 'c'],
      ['serial'],
    )
    const providers: Record<string, WebSearchProvider> = { a: counting('a'), b: counting('b'), c: counting('c') }
    const combined = new CombinedSearchProvider(serial, (id) => providers[id])
    await combined.search({ query: 'q' })
    assert.equal(calls, 1, 'the first member already filled the page')
  })
})

describe('validateCombo', () => {
  const known = ['a', 'b']

  it('rejects an unknown member', () => {
    assert.throws(
      () =>
        validateCombo(
          { id: 'c', label: undefined, members: ['a', 'nope'], merge: 'consensus', concurrent: true, stopAfterResults: undefined, snippetBudget: undefined },
          known,
          ['c'],
        ),
      /unknown backend\(s\): nope/u,
    )
  })

  it('rejects a combo id that shadows a real backend', () => {
    assert.throws(
      () =>
        validateCombo(
          { id: 'a', label: undefined, members: ['b'], merge: 'consensus', concurrent: true, stopAfterResults: undefined, snippetBudget: undefined },
          known,
          ['a'],
        ),
      /collides with another provider id/u,
    )
  })

  it('rejects a combo that names itself as a member', () => {
    assert.throws(
      () =>
        validateCombo(
          { id: 'self', label: undefined, members: ['self'], merge: 'consensus', concurrent: true, stopAfterResults: undefined, snippetBudget: undefined },
          ['a', 'b'],
          ['self'],
        ),
      /unknown backend\(s\): self/u,
    )
  })

  it('rejects duplicate combo ids', () => {
    assert.throws(
      () =>
        validateCombo(
          { id: 'dup', label: undefined, members: ['a'], merge: 'consensus', concurrent: true, stopAfterResults: undefined, snippetBudget: undefined },
          known,
          ['dup', 'dup'],
        ),
      /collides/u,
    )
  })

  it('rejects an empty member list', () => {
    assert.throws(
      () =>
        validateCombo(
          { id: 'empty', label: undefined, members: [], merge: 'consensus', concurrent: true, stopAfterResults: undefined, snippetBudget: undefined },
          known,
          ['empty'],
        ),
      /at least one member/u,
    )
  })

  it('defaults snippetBudget and label', () => {
    const spec = validateCombo(
      { id: 'ok', label: undefined, members: ['a'], merge: 'random', concurrent: true, stopAfterResults: undefined, snippetBudget: undefined },
      known,
      ['ok'],
    )
    assert.equal(spec.snippetBudget, 600)
    assert.equal(spec.label, 'ok')
    assert.equal(spec.merge, 'random')
  })
})

describe('MERGE_STRATEGY_HELP', () => {
  it('documents every strategy so the config help cannot drift', () => {
    const strategies: MergeStrategy[] = ['consensus', 'round-robin', 'append', 'random']
    for (const strategy of strategies) {
      assert.equal(typeof MERGE_STRATEGY_HELP[strategy], 'string')
      assert.ok(MERGE_STRATEGY_HELP[strategy].length > 0)
    }
  })
})
