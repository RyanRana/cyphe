/**
 * CYPHE — Wikipedia Integration Layer
 *
 * Fetches Wikipedia data for any topic and returns a clean structure
 * ready for LLM prompts and graph node creation.
 *
 * Uses: action=query with prop=extracts|links|info
 * Handles: redirects, missing pages, errors
 * Output: title, summary, pageUrl, branches (3-5 curated links), rawLinks
 */

// --- Types -------------------------------------------------------------------

export interface WikipediaNode {
  title: string
  summary: string
  pageUrl: string
  branches: string[]
  rawLinks?: string[]
  categories?: string[]
  error?: string
}

// --- API Constants -----------------------------------------------------------

const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const MAX_SUMMARY_CHARS = 1200 // API limit
const BRANCH_COUNT = 5
const MAIN_NAMESPACE = 0 // Only main article links

// Patterns to exclude from branch candidates (junk links)
const EXCLUDE_PATTERNS = [
  /^Category:/i,
  /^Portal:/i,
  /^List of /i,
  /^Template:/i,
  /^Help:/i,
  /^Wikipedia:/i,
  /^File:/i,
  /^Draft:/i,
  /^User:/i,
  /\(identifier\)$/i,
  /\(journal\)$/i,
  /\(book\)$/i,
  /\(magazine\)$/i,
  /\(disambiguation\)$/i,
  /^\d{4}$/, // Standalone year
  /^[A-Za-z]+ \d{4}$/, // "Month 2024"
  /^\d+$/,
]

// Titles that are typically weak (very short or generic)
const WEAK_TITLES = new Set([
  'edit', 'main', 'index', 'search', 'help', 'about',
  'see also', 'references', 'external links', 'notes',
])

/**
 * Builds the Wikipedia API URL with all required params.
 * origin=* enables CORS for browser usage.
 */
function buildApiUrl(params: Record<string, string>): string {
  const searchParams = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*', // CORS for browser
    redirects: '1', // Follow redirects
    ...params,
  })
  return `${WIKI_API}?${searchParams.toString()}`
}

/**
 * Fetches page data from Wikipedia API.
 * Uses a single request: extracts (intro) + links + info (for canonical URL).
 */
async function fetchWikipediaPage(topic: string, oneSentence = false): Promise<{
  title?: string
  extract?: string
  links?: Array<{ ns: number; title: string }>
  fullurl?: string
  missing?: boolean
}> {
  const url = buildApiUrl({
    prop: 'extracts|links|info',
    titles: topic.trim(),
    exintro: '1',
    explaintext: '1',
    ...(oneSentence ? { exsentences: '1' } : { exchars: String(MAX_SUMMARY_CHARS) }),
    pllimit: '500',
    plnamespace: String(MAIN_NAMESPACE), // Only main space links
    inprop: 'url',
  })

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Wikipedia API error: ${res.status} ${res.statusText}`)
  }

  const json = await res.json()

  if (json.error) {
    throw new Error(json.error.info || json.error.code)
  }

  const pages = json.query?.pages
  if (!pages) {
    throw new Error('Invalid API response: no pages')
  }

  // Get first (and usually only) page - could be -1 if missing
  const pageId = Object.keys(pages)[0]
  const page = pages[pageId]

  if (page.missing !== undefined || pageId === '-1') {
    return { missing: true }
  }

  return {
    title: page.title,
    extract: page.extract,
    links: page.links,
    fullurl: page.fullurl,
  }
}

// Concepts that suggest strong exploration branches (science/topic terms)
const CONCEPT_PATTERNS = [
  /\b(quantum|theory|paradox|mechanics|physics|chemistry|biology)\b/i,
  /\b(principle|effect|law|theorem|experiment|phenomenon)\b/i,
  /\b(history|introduction|interpretation|foundation)\b/i,
  /^[A-Za-z]+ of /, // "X of Y"
  /^[A-Za-z]+ and [A-Za-z]+/, // "X and Y"
]

// "First Last" pattern often indicates a person (deprioritize for exploration)
function looksLikePersonName(title: string): boolean {
  const words = title.split(/\s+/)
  if (words.length !== 2) return false
  return /^[A-Z][a-z]+$/.test(words[0]) && /^[A-Z][a-z]+$/.test(words[1])
}

/**
 * Filters and scores a link for branch candidacy.
 * Returns a score (higher = better). 0 = exclude.
 */
function scoreLink(title: string, index: number): number {
  const t = title.trim()
  if (!t || t.length < 4) return 0
  if (WEAK_TITLES.has(t.toLowerCase())) return 0

  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(t)) return 0
  }

  // Prefer links that appear early (Wikipedia often puts key concepts first)
  const positionScore = Math.max(0, 100 - index * 2)

  // Prefer longer, more specific titles (avoid "X (concept)" too short)
  const lengthBonus = Math.min(t.length * 0.5, 20)

  // Penalize titles with too many colons or parentheses (often meta)
  const cleanBonus = !t.includes(':') ? 10 : 0
  const parenPenalty = (t.match(/\(/g)?.length || 0) * 5

  // Boost concept-like titles (theory, paradox, mechanics, etc.)
  const conceptBonus = CONCEPT_PATTERNS.some((p) => p.test(t)) ? 25 : 0

  // Slight penalty for person names (prefer conceptual topics for exploration)
  const personPenalty = looksLikePersonName(t) ? 15 : 0

  return positionScore + lengthBonus + cleanBonus + conceptBonus - parenPenalty - personPenalty
}

/**
 * Selects 3-5 best branch topics from raw links using heuristics.
 * Avoids junk, prefers early/semantic links.
 */
function selectBranches(links: Array<{ ns: number; title: string }>): string[] {
  if (!links?.length) return []

  const scored = links
    .map((link, i) => ({
      title: link.title,
      score: scoreLink(link.title, i),
    }))
    .filter((x) => x.score > 0)

  // Sort by score descending, then take top N, dedupe by normalized title
  const seen = new Set<string>()
  const branches: string[] = []

  for (const { title } of scored.sort((a, b) => b.score - a.score)) {
    const normalized = title.toLowerCase().trim()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    branches.push(title)
    if (branches.length >= BRANCH_COUNT) break
  }

  return branches
}

/**
 * Main entry point: fetch a Wikipedia node for any topic.
 * Returns a clean structure ready for LLM or graph consumption.
 *
 * @param topic - The topic to look up (e.g. "Quantum entanglement")
 * @returns WikipediaNode with title, summary, pageUrl, branches
 *
 * @example
 * const node = await getWikipediaNode("Quantum entanglement")
 * console.log(node.summary)
 * console.log(node.branches) // ["Quantum mechanics", "Bell's theorem", ...]
 */
export async function getWikipediaNode(topic: string, oneSentence = false): Promise<WikipediaNode> {
  const emptyNode: WikipediaNode = {
    title: '',
    summary: '',
    pageUrl: '',
    branches: [],
  }

  try {
    if (!topic?.trim()) {
      return { ...emptyNode, error: 'Topic is required' }
    }

    const data = await fetchWikipediaPage(topic, oneSentence)

    if (data.missing) {
      return {
        ...emptyNode,
        error: `No Wikipedia page found for "${topic}"`,
      }
    }

    const rawLinks = (data.links || []).map((l) => l.title)
    const branches = selectBranches(data.links || [])

    return {
      title: data.title || topic,
      summary: (data.extract || '').trim() || 'No summary available.',
      pageUrl: data.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title || topic)}`,
      branches,
      rawLinks,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ...emptyNode,
      error: `Wikipedia fetch failed: ${message}`,
    }
  }
}

// --- Caching (suggested structure) ------------------------------------------
//
// For production, add a cache layer:
//
// 1. In-memory (Node): Map<topic, { node, timestamp }>
// 2. LRU with TTL (e.g. 24h for summaries, 1h for branches)
// 3. Key: normalize topic (trim, lowercase) for deduplication
//
// Example:
//   const cache = new Map<string, { node: WikipediaNode; expires: number }>()
//   const key = topic.trim().toLowerCase()
//   const cached = cache.get(key)
//   if (cached && Date.now() < cached.expires) return cached.node
//   const node = await getWikipediaNode(topic)
//   if (!node.error) cache.set(key, { node, expires: Date.now() + 3600000 })
//   return node
//
// For serverless: use Redis or similar with topic as key.

/**
 * Search Wikipedia for best matching article (for root/initial queries).
 * Uses list=search for fuzzy matching, then fetches the top result.
 * Better than exact title lookup for natural language queries.
 */
export async function searchAndFetchRoot(query: string): Promise<WikipediaNode> {
  try {
    const searchUrl = `${WIKI_API}?${new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      list: 'search',
      srsearch: query.trim(),
      srlimit: '1',
      srprop: 'snippet',
    }).toString()}`

    const searchRes = await fetch(searchUrl)
    if (!searchRes.ok) {
      return getWikipediaNode(query)
    }

    const searchJson = await searchRes.json()
    const results = searchJson.query?.search
    if (!results?.length) {
      return getWikipediaNode(query)
    }

    const bestTitle = results[0].title
    return getWikipediaNode(bestTitle)
  } catch {
    return getWikipediaNode(query)
  }
}
