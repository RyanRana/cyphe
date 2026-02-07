/**
 * CYPHE — Smart link/topic filtering
 *
 * Filters out junk (lists, dates, meta pages) to avoid exploration loops.
 */

const EXCLUDE_PATTERNS = [
  /^Category:/i,
  /^Portal:/i,
  /^List of /i,
  /^Lists of /i,
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
  /^\d{4}$/,
  /^[A-Za-z]+ \d{4}$/,
  /^\d+$/,
  /^\d+ (January|February|March|April|May|June|July|August|September|October|November|December)/i,
  /^Timeline of /i,
  /^Index of /i,
  /^Outline of /i,
  /^Glossary of /i,
  /\b(19|20)\d{2}\b/, // titles dominated by years (e.g. "2024 in X", "X in 2020")
  /election.*\d{4}|\d{4}.*election/i,
  /^\d{4} in /i,
  / in \d{4}$/i,
  /^ISO \d+/i,
  /^Year \d+/i,
]

const WEAK_TITLES = new Set([
  'edit', 'main', 'index', 'search', 'help', 'about',
  'see also', 'references', 'external links', 'notes', 'contents',
])

/** Returns true if the title should be excluded from exploration */
export function isJunkTitle(title: string): boolean {
  const t = title.trim()
  if (!t || t.length < 4) return true
  if (WEAK_TITLES.has(t.toLowerCase())) return true
  return EXCLUDE_PATTERNS.some((p) => p.test(t))
}

/** Lenient filter: only excludes worst junk. Use when smart filter returns empty to keep loop going. */
export function filterSmartLinksLenient(titles: string[], max = 10): string[] {
  const worst = [/^List of /i, /^Category:/i, /^\d{4}$/, /^Wikipedia:/i, /\(disambiguation\)$/i]
  const seen = new Set<string>()
  return titles
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !worst.some((p) => p.test(t)))
    .filter((t) => {
      const n = t.toLowerCase()
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
    .slice(0, max)
}

/** Filter and return top N smart branch titles, scored by quality (best first) */
export function filterSmartLinks(titles: string[], max = 5): string[] {
  const score = (t: string) => {
    const s = t.trim()
    if (!s || s.length < 4) return 0
    let v = Math.min(s.length * 0.3, 15) + (!s.includes(':') ? 10 : 0)
    v -= (s.match(/\(/g)?.length || 0) * 5
    if (/\b(theory|law|effect|principle|mechanics|physics|chemistry|biology)\b/i.test(s)) v += 25
    if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(s)) v -= 15
    if (/\b(by year|by country|by decade|chronological)\b/i.test(s)) v -= 20
    if (/\d{4}/.test(s)) v -= 10
    return v
  }
  const seen = new Set<string>()
  return titles
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !isJunkTitle(t))
    .filter((t) => {
      const n = t.toLowerCase()
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.t)
}
