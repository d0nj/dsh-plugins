/**
 * Result fusion for combined providers.
 *
 * A "combo" is one registered search provider that fans a single query out to
 * several backends and merges what they return. The seam caps the merged list at
 * `maxResults` and `dsh-tool-web` does not cap it again, so the fusion here
 * decides what the model actually reads.
 *
 * The hard part is not concatenation, it is agreement: two engines return the
 * same article under six spellings of one URL (`www.`, trailing slash, `#frag`,
 * campaign parameters, `http` vs `https`, AMP and mobile variants). Merging on
 * the raw string produces a list where the same page appears five times and the
 * model cites it five times. {@link normalizeUrl} collapses those spellings
 * before anything is compared.
 *
 * @module @d0nj/dsh-websearch-multi/fusion
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/** How several backends' results are combined into one list. */
export type MergeStrategy =
  /**
   * Rank by agreement: a URL several backends returned outranks one that only a
   * single backend did, and within an equal number of votes the better mean rank
   * wins. The default, because agreement is the strongest relevance signal
   * available across providers that rank differently.
   */
  | 'consensus'
  /**
   * Take one result from each backend in turn, then the second from each, and so
   * on. Keeps the first page representative of every backend instead of letting
   * the first one fill it.
   */
  | 'round-robin'
  /**
   * List each backend's results in its own order, one backend after another.
   * Chooses the first backend's judgement whole when it is trusted most.
   */
  | 'append'
  /**
   * Shuffle the deduplicated pool. For exploring past the head of the ranked
   * lists, at the cost of repeatability.
   */
  | 'random'

/** Parameters that only track a campaign, never identify different content. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_reader',
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref_src',
  'ref_url',
  'spm',
  'scm',
  'share_token',
  'share_source',
])

/**
 * Hosts whose content is identical to the canonical article but whose URL is
 * not, because the variant is a separate origin rather than a path change.
 */
const CANONICAL_HOSTS: Readonly<Record<string, string>> = {
  'mobile.twitter.com': 'twitter.com',
  'm.twitter.com': 'twitter.com',
  'mobile.reddit.com': 'reddit.com',
  'old.reddit.com': 'reddit.com',
  'new.reddit.com': 'reddit.com',
  'm.youtube.com': 'youtube.com',
  'music.youtube.com': 'youtube.com',
  'm.facebook.com': 'facebook.com',
  'mobile.wikipedia.org': 'wikipedia.org',
  'm.wikipedia.org': 'wikipedia.org',
}

/**
 * Normalize a URL to the identity two backends would agree on.
 *
 * Two results are the same resource when their scheme, `www.` prefix, default
 * port, trailing slash, leading `amp.`/`m.` host, AMP path suffix, fragment,
 * tracking parameters, and parameter order all agree after normalization. The
 * result is used only for comparison; the displayed URL stays as the best
 * backend supplied it.
 *
 * @param raw - the URL as a backend returned it.
 * @returns the comparison key; an unparseable URL is its own key, trimmed.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // An unparseable URL still has to key something, or it would be dropped
    // silently and the model would never see that a backend returned junk.
    return trimmed.toLowerCase()
  }

  let host = url.hostname.toLowerCase()
  // `amp.example.com` and `www.example.com` serve the same article.
  for (const prefix of ['www.', 'amp.', 'm.']) {
    if (host.startsWith(prefix) && host.length > prefix.length) {
      host = host.slice(prefix.length)
      break
    }
  }
  host = CANONICAL_HOSTS[host] ?? host
  // A non-default port is part of the identity: :8443 is a different service,
  // so it must not collapse onto the bare host. The URL parser already dropped
  // the default port, which is why `url.port` is empty for http/https defaults.
  const authority = url.port.length === 0 ? host : `${host}:${url.port}`

  let path = url.pathname
  // An AMP path suffix is the same document.
  path = path.replace(/\/amp\/?$/u, '').replace(/\.amp$/u, '')
  // Collapse a trailing slash so `/a` and `/a/` agree, but keep the root.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right))
  const query = params.length === 0 ? '' : `?${params.map(([k, v]) => `${k}=${v}`).join('&')}`

  // The scheme is intentionally absent so http and https agree, but the
  // authority keeps a non-default port so two services on one host stay distinct.
  return `${authority}${path}${query}`.toLowerCase()
}

/**
 * Pick the display URL among several spellings of the same page.
 *
 * Prefers `https`, then a host without a mobile/AMP prefix, then the shortest
 * form — which is the one least likely to carry a session or tracking suffix.
 *
 * @param candidates - every spelling seen for one normalized URL.
 * @returns the spelling to show the model.
 */
function bestDisplayUrl(candidates: readonly string[]): string {
  const scored = candidates.map((candidate) => {
    let score = 0
    if (candidate.startsWith('https://')) score += 8
    // A campaign parameter or a fragment makes a URL a worse thing to cite.
    if (/[?#]/u.test(candidate)) score -= 2
    if (/\/(amp|mobile)\/?$/iu.test(candidate)) score -= 4
    if (/^https?:\/\/(www\.)?(amp\.|m\.)/iu.test(candidate)) score -= 4
    score -= candidate.length / 200
    return { candidate, score }
  })
  scored.sort((left, right) => right.score - left.score)
  return (scored[0] ?? { candidate: candidates[0] ?? '' }).candidate
}

/** One result after fusion, with the votes it earned. */
interface FusedSource {
  /** Comparison key from {@link normalizeUrl}. */
  readonly key: string
  /** Every spelling seen for this page, best-first. */
  readonly urls: readonly string[]
  /** Titles seen, first non-empty per backend in arrival order. */
  readonly titles: readonly string[]
  /** Snippets seen, kept separate so they can be merged without duplication. */
  readonly snippets: readonly string[]
  /** Publication dates seen, earliest first (the article's own date). */
  readonly dates: readonly string[]
  /** How many distinct backends returned this page. */
  readonly votes: number
  /** Sum of the 0-based ranks it occupied, for tie-breaking. */
  readonly rankSum: number
  /** Order in which the page was first seen, for stable output. */
  readonly firstSeen: number
}

/**
 * Collect one backend's results into the shared pool.
 *
 * A backend is counted once per page no matter how many spellings of the URL it
 * returned, so a backend that lists an article twice cannot outvote two
 * backends that agree. The caller therefore passes one backend's list at a time.
 *
 * @param pool - accumulated results, keyed by normalized URL.
 * @param sources - one backend's results in its own rank order.
 * @param order - running counter for first-seen ordering.
 */
function absorb(
  pool: Map<string, FusedSource>,
  sources: readonly WebSearchSource[],
  order: { next: number },
): void {
  // Every key this backend contributed to, so a repeat spelling is recognized
  // as the same backend's vote rather than a second one.
  const contributed = new Set<string>()
  sources.forEach((source, rank) => {
    const key = normalizeUrl(source.url)
    if (key.length === 0) return
    const firstFromThisBackend = !contributed.has(key)
    contributed.add(key)
    const existing = pool.get(key)
    if (existing === undefined) {
      pool.set(key, {
        key,
        urls: [source.url],
        titles: source.title === undefined ? [] : [source.title],
        snippets: source.snippet === undefined ? [] : [source.snippet],
        dates: source.publishedAt === undefined ? [] : [source.publishedAt],
        votes: 1,
        rankSum: rank,
        firstSeen: order.next,
      })
      order.next += 1
      return
    }
    pool.set(key, {
      key: existing.key,
      urls: existing.urls.includes(source.url) ? existing.urls : [...existing.urls, source.url],
      titles:
        source.title === undefined || existing.titles.includes(source.title)
          ? existing.titles
          : [...existing.titles, source.title],
      snippets:
        source.snippet === undefined || existing.snippets.includes(source.snippet)
          ? existing.snippets
          : [...existing.snippets, source.snippet],
      dates:
        source.publishedAt === undefined || existing.dates.includes(source.publishedAt)
          ? existing.dates
          : [...existing.dates, source.publishedAt],
      // Only a backend that had not already returned this page adds a vote, and
      // only its best rank counts toward the mean position.
      votes: existing.votes + (firstFromThisBackend ? 1 : 0),
      rankSum: existing.rankSum + (firstFromThisBackend ? rank : 0),
      firstSeen: existing.firstSeen,
    })
  })
}

/**
 * Merge snippets from several backends into one.
 *
 * Backends disagree about snippet length: one returns a two-line abstract, the
 * next a full paragraph from the page. Keeping every distinct snippet makes an
 * agreed result balloon, so the longest few are kept in a bounded budget that
 * still reflects several sources.
 *
 * @param snippets - distinct snippets for one page.
 * @param budget - maximum characters to keep.
 * @returns the merged snippet, or `undefined` when none exists.
 */
function mergeSnippets(snippets: readonly string[], budget: number): string | undefined {
  if (snippets.length === 0) return undefined
  const unique = [...new Set(snippets.map((snippet) => snippet.trim()))].filter(
    (snippet) => snippet.length > 0,
  )
  if (unique.length === 0) return undefined
  // Longest first: a longer snippet usually carries a full clause rather than a
  // truncated fragment, and a fragment that is a prefix of it adds nothing.
  const ordered = [...unique].sort((left, right) => right.length - left.length)
  const kept: string[] = []
  let used = 0
  for (const snippet of ordered) {
    const alreadyCovered = kept.some((existing) => existing.includes(snippet))
    if (alreadyCovered) continue
    if (used + snippet.length > budget && kept.length > 0) continue
    kept.push(snippet)
    used += snippet.length
  }
  return kept.length === 0 ? undefined : kept.join(' ')
}

/**
 * Choose the publication date to show: the earliest, since a page quoted by a
 * news index and by a general index should keep the article's own date rather
 * than the most recent crawl.
 * @param dates - distinct dates seen.
 * @returns the ISO date, or `undefined`.
 */
function mergeDate(dates: readonly string[]): string | undefined {
  const usable = dates.map((date) => date.trim()).filter((date) => date.length > 0)
  if (usable.length === 0) return undefined
  return [...usable].sort((left, right) => left.localeCompare(right))[0]
}

/**
 * Flatten the pool into the seam's source shape.
 * @param pooled - one fused entry.
 * @param snippetBudget - characters allowed for the merged snippet.
 * @returns the source the model sees.
 */
function project(pooled: FusedSource, snippetBudget: number): WebSearchSource {
  const snippet = mergeSnippets(pooled.snippets, snippetBudget)
  const date = mergeDate(pooled.dates)
  return {
    url: bestDisplayUrl(pooled.urls),
    ...(pooled.titles.length === 0 ? {} : { title: pooled.titles[0] }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(date === undefined ? {} : { publishedAt: date }),
  }
}

/**
 * Shuffle with a seeded generator.
 *
 * A deterministic shuffle is used for `random` so a replayed session produces
 * the same sources. Cryptographic randomness would make a fork of the same turn
 * cite different pages, which is worse than the small bias a seed introduces.
 *
 * @param items - items to shuffle.
 * @param seed - any integer; the same seed and length give the same order.
 * @returns a shuffled copy.
 */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items]
  let state = seed >>> 0
  for (let index = result.length - 1; index > 0; index -= 1) {
    // xorshift32: cheap, adequate here, and identical across platforms.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    const swap = state % (index + 1)
    const a = result[index] as T
    const b = result[swap] as T
    result[index] = b
    result[swap] = a
  }
  return result
}

/** Options controlling one fusion. */
export interface FuseOptions {
  /** How to order the merged list. */
  readonly strategy: MergeStrategy
  /** Maximum characters kept per merged snippet. */
  readonly snippetBudget: number
  /**
   * Cap on the merged source list. The seam applies its own cap afterwards, but
   * stopping here avoids materializing results that will be dropped.
   */
  readonly maxResults: number
  /** Seed for `random`, so a replay reproduces the order. */
  readonly seed: number
}

/**
 * Fuse several backends' results into one ranked list.
 *
 * @param results - each backend's sources, grouped by backend in priority order.
 * @param options - strategy, snippet budget, and caps.
 * @returns the merged sources, with duplicates collapsed and snippets blended.
 */
export function fuseResults(
  results: readonly (readonly WebSearchSource[])[],
  options: FuseOptions,
): readonly WebSearchSource[] {
  const pool = new Map<string, FusedSource>()
  const order = { next: 0 }
  for (const sources of results) absorb(pool, sources, order)

  const pooled = [...pool.values()]

  let ordered: FusedSource[]
  switch (options.strategy) {
    case 'consensus':
      ordered = [...pooled].sort((left, right) => {
        // More backends agreeing is the strongest signal, then the better mean
        // position, then first arrival for a stable order between equals.
        if (right.votes !== left.votes) return right.votes - left.votes
        const leftMean = left.rankSum / left.votes
        const rightMean = right.rankSum / right.votes
        if (leftMean !== rightMean) return leftMean - rightMean
        return left.firstSeen - right.firstSeen
      })
      break
    case 'round-robin': {
      // Rank by mean position across the backends that returned the page, which
      // is what "take the best of each backend's next rank" approximates once
      // duplicates are collapsed.
      ordered = [...pooled].sort((left, right) => {
        const leftMean = left.rankSum / left.votes
        const rightMean = right.rankSum / right.votes
        if (leftMean !== rightMean) return leftMean - rightMean
        return left.firstSeen - right.firstSeen
      })
      break
    }
    case 'append':
      // First-seen order already follows the backends' own priority, because the
      // pool absorbs them in the configured order.
      ordered = [...pooled].sort((left, right) => left.firstSeen - right.firstSeen)
      break
    case 'random':
      ordered = seededShuffle(pooled, options.seed)
      break
  }

  return ordered
    .slice(0, options.maxResults)
    .map((pooledSource) => project(pooledSource, options.snippetBudget))
}