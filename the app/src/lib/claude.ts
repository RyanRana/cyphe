/**
 * CYPHE — Claude API integration
 *
 * 1. Branch selection: picks most important/explorable links from Wikipedia
 * 2. Narrative transitions: smooth prose between nodes
 *
 * Requires: ANTHROPIC_API_KEY in environment (server-side only)
 */

import type { GraphNode } from './graph'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

// Junk patterns to pre-filter before sending to Claude (saves tokens)
const JUNK_PATTERNS = [
  /^Category:/i, /^Portal:/i, /^Template:/i, /^Help:/i, /^Wikipedia:/i,
  /^File:/i, /\(identifier\)$/i, /\(journal\)$/i, /\(book\)$/i,
  /\(disambiguation\)$/i, /^\d{4}$/, /^[A-Za-z]+ \d{4}$/, /^\d+$/,
]

function filterLinksForLLM(links: string[]): string[] {
  return links
    .filter((t) => t.length > 3 && !JUNK_PATTERNS.some((p) => p.test(t)))
    .slice(0, 100) // First 100 by Wikipedia order (usually most relevant)
}

const TRANSITION_SYSTEM = `Write ONE short connecting sentence between two topics. Max 1 sentence. Be natural and flowing, like a narrator guiding the reader. Nothing else.`

const BRANCH_SYSTEM = `You are a knowledge curator designing exploration paths through Wikipedia. Given an article and its outgoing links, select the 5 most compelling branches for a curious reader.

Your selections should:
- Reveal surprising or illuminating connections to the main topic
- Include foundational concepts that deepen understanding
- Bridge different fields when possible (science ↔ philosophy, history ↔ technology)
- Have rich exploration potential themselves
- Create a diverse set of directions (don't cluster around one sub-theme)

Avoid: narrow jargon, standalone dates, administrative pages, people names, or topics that dead-end.
Return ONLY a JSON array of exactly 5 link titles from the provided list.`

function buildTransitionPrompt(from: GraphNode, to: GraphNode): string {
  return `"${from.title}" → "${to.title}". One sentence connecting these topics.`
}

/**
 * Generates a narrative transition between two graph nodes.
 * Call from server-side only (API key must not be exposed).
 *
 * @param from - Current node (user is leaving)
 * @param to - Next node (user is entering)
 * @returns Transition text (1-3 sentences)
 */
export async function generateTransition(
  from: GraphNode,
  to: GraphNode
): Promise<string> {
  const apiKey = typeof process !== 'undefined' && process.env?.ANTHROPIC_API_KEY
  if (!apiKey) {
    return '' // No API key: no transition, frontend can show summary directly
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 60,
        system: TRANSITION_SYSTEM,
        messages: [
          {
            role: 'user',
            content: buildTransitionPrompt(from, to),
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Claude API error:', res.status, err)
      return ''
    }

    const data = await res.json()
    const text = data.content?.[0]?.text
    return (text || '').trim()
  } catch (err) {
    console.error('Claude API error:', err)
    return ''
  }
}

/**
 * Uses Claude to select the 5 most important exploration branches from
 * a Wikipedia article's outgoing links. Replaces heuristic ranking.
 */
export async function selectBranchesWithLLM(
  summary: string,
  rawLinks: string[],
  topic: string,
  engagementContext?: string
): Promise<string[]> {
  const apiKey = typeof process !== 'undefined' && process.env?.ANTHROPIC_API_KEY
  if (!apiKey) return []

  const candidates = filterLinksForLLM(rawLinks)
  if (candidates.length === 0) return []

  const prompt = `Article: "${topic}"
Summary: ${summary.slice(0, 600)}
${engagementContext ? `\nReader context: ${engagementContext}\n` : ''}
Outgoing links (pick the 5 best for exploration):
${candidates.map((t) => `- ${t}`).join('\n')}

Return a JSON array of exactly 5 link titles.`

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 200,
        system: BRANCH_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error('Claude branch selection error:', res.status, await res.text())
      return []
    }

    const data = await res.json()
    const text = (data.content?.[0]?.text || '').trim()

    // Parse JSON array from response (may be wrapped in markdown)
    const match = text.match(/\[[\s\S]*?\]/)
    if (!match) return []
    const arr = JSON.parse(match[0]) as string[]
    return Array.isArray(arr) ? arr.slice(0, 5).filter((s) => typeof s === 'string') : []
  } catch (err) {
    console.error('Claude branch selection error:', err)
    return []
  }
}
