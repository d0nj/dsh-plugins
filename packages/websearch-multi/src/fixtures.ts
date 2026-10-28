/**
 * Recorded provider payloads.
 *
 * Each fixture is a response shape copied from the provider's own documentation
 * or from its published OpenAPI example, trimmed to the fields the adapter reads.
 * Keeping them here rather than generating them means a provider contract change
 * shows up as a failing assertion against a payload a human can compare with the
 * docs, instead of as a live-network surprise.
 */

/** Tavily `POST /search` — docs.tavily.com, includes the generated answer. */
export const tavilySearch = {
  query: 'who is Leo Messi?',
  answer: 'Lionel Messi is an Argentine footballer born in 1987.',
  results: [
    {
      title: 'Lionel Messi Facts | Britannica',
      url: 'https://www.britannica.com/facts/Lionel-Messi',
      content: 'Lionel Messi, an Argentine footballer, is widely regarded as one of the greatest.',
      score: 0.81,
      published_date: 'Tue, 11 Mar 2025 17:00:00 GMT',
    },
    {
      title: 'Lionel Messi - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Lionel_Messi',
      content: 'Lionel Andrés Messi is an Argentine professional footballer.',
    },
    {
      // A duplicate URL and a result with no URL: both must be dropped.
      title: 'Duplicate',
      url: 'https://en.wikipedia.org/wiki/Lionel_Messi',
      content: 'duplicate entry',
    },
    { title: 'No URL', content: 'dropped' },
  ],
}

/** Exa `POST /search` — docs.exa.ai; there is no `snippet` or `content` field. */
export const exaSearch = {
  requestId: '8f3a',
  results: [
    {
      title: 'Sample webpage title',
      url: 'https://www.example.com',
      publishedDate: '2024-01-15',
      highlights: ['Relevant snippet one.', 'Relevant snippet two.'],
      summary: 'Summary of the webpage.',
    },
    {
      title: 'Summary only',
      url: 'https://www.example.org',
      summary: 'Falls back to the summary when no highlights came back.',
    },
  ],
}

/** Parallel `POST /v1/search` — docs.parallel.ai public OpenAPI example. */
export const parallelSearch = {
  search_id: 'search_fcb2b4f3c75e418687bccaa1a8381331',
  results: [
    {
      url: 'https://www.example.com',
      title: 'Sample webpage title',
      publish_date: '2024-01-15',
      excerpts: ['Sample excerpt 1', 'Sample excerpt 2'],
    },
    { url: 'https://www.example.org', title: null, excerpts: [] },
  ],
  session_id: 'session_fcb2',
}

/** TinyFish `GET /?query=` — docs.tinyfish.ai, note `site_name` and `position`. */
export const tinyfishSearch = {
  query: 'web automation tools',
  results: [
    {
      position: 1,
      site_name: 'tinyfish.ai',
      title: 'TinyFish — AI Web Automation Platform',
      snippet: 'Automate any website with natural language instructions.',
      url: 'https://tinyfish.ai',
      date: '2026-05-01',
    },
    {
      position: 2,
      site_name: 'github.com',
      snippet: 'A curated list of browser automation frameworks.',
      url: 'https://github.com/example/web-automation-tools',
    },
  ],
  total_results: 2,
  page: 0,
}

/** Firecrawl `POST /v2/search` — docs.firecrawl.dev; web results are undated. */
export const firecrawlSearch = {
  success: true,
  data: {
    web: [
      {
        url: 'https://arxiv.org/abs/2024.12345',
        title: 'ML Research Paper',
        description: 'Latest advances in machine learning',
      },
      {
        url: 'https://example.com/ml-survey.pdf',
        title: 'ML Survey',
        description: null,
        markdown: 'Fallback body when the description is empty.',
      },
    ],
  },
}

/** Firecrawl's own failure envelope. */
export const firecrawlFailure = {
  success: false,
  error: 'Unfortunately, your IP address looks like a VPN or proxy.',
}

/** Linkup `POST /v1/search` with `outputType: sourcedAnswer` — title is `name`. */
export const linkupSearch = {
  answer: "Microsoft's 2024 revenue was $245.1 billion.",
  sources: [
    {
      name: 'Microsoft 2024 Annual Report',
      url: 'https://www.microsoft.com/investor/reports/2024',
      snippet: 'Annual revenue was $245.1 billion.',
      favicon: 'https://www.microsoft.com/favicon.ico',
    },
  ],
}

/** Brave `GET /res/v1/web/search` — results live under `web.results`. */
export const braveSearch = {
  type: 'search',
  query: { original: 'python frameworks', altered: 'python web frameworks' },
  web: {
    type: 'search',
    results: [
      {
        title: 'Top Python Web Frameworks',
        url: 'https://example.com/python-frameworks',
        description: 'A comprehensive guide to Python web frameworks.',
        page_age: '2026-04-01T12:00:00',
        extra_snippets: ['Additional excerpt 1', 'Additional excerpt 2'],
      },
      {
        title: 'No description, extra snippets only',
        url: 'https://example.com/no-description',
        extra_snippets: ['Only the extra snippets exist here.'],
      },
    ],
  },
}

/** Kagi `POST /api/v1/search` — web results live under `data.search`. */
export const kagiSearch = {
  data: {
    search: [
      {
        url: 'https://example.com/kagi-result',
        title: 'A Kagi result',
        snippet: 'The Kagi snippet.',
        time: '2026-01-02T03:04:05Z',
      },
    ],
    news: [{ url: 'https://example.com/news', title: 'Ignored news arm' }],
  },
}

/** Perplexity `POST /search` — results only, no answer field. */
export const perplexitySearch = {
  results: [
    {
      title: 'Latest AI developments',
      url: 'https://example.com/ai',
      snippet: 'A summary of recent developments.',
      date: '2026-04-02',
      last_updated: '2026-04-03',
    },
  ],
  id: 'abc',
  server_time: '2026-04-03T00:00:00Z',
}

/** Serper `POST /search` — organic results use `link`, not `url`. */
export const serperSearch = {
  organic: [
    {
      title: 'Google Search - Wikipedia',
      link: 'https://en.wikipedia.org/wiki/Google_Search',
      snippet: 'Google Search is a search engine provided and operated by Google.',
      position: 1,
    },
    {
      title: 'What Google Search Is Not Showing You',
      link: 'https://www.newyorker.com/culture/infinite-scroll/what-google-search-isnt-showing-you',
      snippet: 'The search engine has made up so much of our online experience.',
      date: 'Mar 10, 2022',
      position: 2,
    },
  ],
  knowledgeGraph: { description: 'A knowledge-graph description.' },
}

/** Jina `GET https://s.jina.ai/?q=` with `Accept: application/json` — a bare array. */
export const jinaSearch = [
  {
    title: 'Mount Everest - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Mount_Everest',
    description: "Mount Everest is Earth's highest mountain above sea level.",
    content: 'Mount Everest\n\nFull page text.',
    date: '2026-04-02T10:11:12.000Z',
    usage: { tokens: 10000 },
  },
]

/** SearXNG `GET /search?format=json` — answers and results are siblings. */
export const searxngSearch = {
  query: 'searxng',
  answers: [{ answer: 'An instant answer.' }],
  results: [
    {
      url: 'https://docs.searxng.org',
      title: 'SearXNG documentation',
      content: 'The documentation for SearXNG.',
      publishedDate: '2026-02-03T00:00:00Z',
    },
  ],
}

/** Mojeek `GET /search?fmt=json` — `desc` is the snippet, under `response`. */
export const mojeekSearch = {
  response: {
    status: 'success',
    results: [
      {
        url: 'https://example.com/mojeek',
        title: 'Mojeek result',
        desc: 'The Mojeek description.',
        date: '2026-03-04',
      },
    ],
    head: { query: 'mojeek', results: 1 },
  },
}

/** Tavily `POST /extract`. */
export const tavilyExtract = {
  results: [
    {
      url: 'https://example.com',
      raw_content: '# Example Domain\n\nThis domain is for use in documentation examples.',
    },
  ],
  failed_results: [],
}

/** Tavily extract reporting a per-URL failure. */
export const tavilyExtractFailure = {
  results: [],
  failed_results: [{ url: 'https://example.com', error: 'site is down' }],
}

/** Exa `POST /contents`. */
export const exaContents = {
  results: [
    {
      url: 'https://example.com',
      title: 'Example Domain',
      text: 'This domain is for use in documentation examples.',
      statusCode: 200,
    },
  ],
}

/** Firecrawl `POST /scrape`. */
export const firecrawlScrape = {
  success: true,
  data: {
    markdown: '# Example Domain\n\nThis domain is for use in documentation examples.',
    metadata: { title: 'Example Domain', url: 'https://example.com', statusCode: 200 },
  },
}

/** Jina Reader `GET r.jina.ai/<url>` answer body. */
export const jinaReader = `Title: Example Domain

URL Source: https://example.com/

Markdown Content:
This domain is for use in documentation examples without needing permission.
`
