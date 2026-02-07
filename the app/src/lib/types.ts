/**
 * CYPHE — Centralized types for feed, content, and exploration
 */

import type { GraphNode } from './graph'

// ── Content API (uhaccs / SciScroll) ───────────────────────────────────────

export type ContentBlockType =
  | 'text'
  | 'unsplash'
  | 'wikipedia_image'
  | 'wikimedia'
  | 'reddit'
  | 'xkcd'
  | 'meme'
  | 'tweet'

export interface ContentBlock {
  id: string
  type: ContentBlockType
  content: string
  group_id: string
  group_role: string
  media?: {
    url: string
    title?: string
    alt_text?: string
    text?: string
    source: string
    [key: string]: unknown
  }
}

export interface NextNode {
  id: string
  label: string
}

// ── Feed items (unified) ────────────────────────────────────────────────────

export type ContentFeedItem = {
  source: 'content'
  title: string
  nodeId: string
  contentBlocks: ContentBlock[]
  nextNodes: NextNode[]
  transition?: string
}

export type WikipediaFeedItem = {
  source: 'wikipedia'
  node: GraphNode
  transition?: string
  supplementalMedia?: ContentBlock[]
  /** Blocks queued to appear when user scrolls previous into view */
  supplementalPending?: ContentBlock[]
}

export type FeedItem = ContentFeedItem | WikipediaFeedItem

export function isContentItem(item: FeedItem): item is ContentFeedItem {
  return item.source === 'content'
}

export function isWikipediaItem(item: FeedItem): item is WikipediaFeedItem {
  return item.source === 'wikipedia'
}

// ── Media source labels ─────────────────────────────────────────────────────

export const MEDIA_SOURCE_LABELS: Record<string, string> = {
  unsplash: 'Unsplash',
  wikipedia_image: 'Wikipedia',
  wikimedia: 'Wikimedia Commons',
  reddit: 'Reddit',
  xkcd: 'XKCD',
  meme: 'Imgflip',
  tweet: 'X (Twitter)',
}

export function getMediaSourceLabel(block: ContentBlock): string {
  if (block.type === 'text') return ''
  const src = block.media?.source ?? block.type
  return MEDIA_SOURCE_LABELS[src] ?? src
}

export function isMediaBlock(block: ContentBlock): block is ContentBlock & { media: NonNullable<ContentBlock['media']> } {
  return block.type !== 'text' && !!block.media
}

/** Reddit and tweet blocks have permalink URLs (post links), not image URLs. Render as link cards. */
export function isLinkMediaBlock(block: ContentBlock): block is ContentBlock & { media: NonNullable<ContentBlock['media']> } {
  return (block.type === 'reddit' || block.type === 'tweet') && !!block.media?.url
}

/** Filter out prompt-like or placeholder content (LLM artifacts) */
const PROMPT_PATTERNS = [
  /^(generate|write|create|produce|output|return)\s+(a\s+)?/i,
  /^(here('s| is)\s+(a\s+)?)/i,
  /^(as\s+an?\s+ai|as\s+a\s+language\s+model)/i,
  /^(sure,?\s*(here|i('ll| will)))/i,
  /^\[.*(prompt|instruction|query).*\]/i,
  /^(topic|query|subject):\s*.{0,50}$/i,
  /^—\s*(unsplash|reddit|xkcd|meme|tweet)\s+content$/i,
]
export function isPromptLike(text: string): boolean {
  if (!text || text.length < 20) return false
  const t = text.trim()
  return PROMPT_PATTERNS.some((p) => p.test(t))
}

/** Get displayable content for a block — prefer real media text, filter prompts */
export function getBlockDisplayContent(block: ContentBlock): string {
  if (block.type === 'tweet' && block.media?.text) return block.media.text
  if (block.type === 'reddit' && block.media?.title) return block.media.title
  if (block.content && !isPromptLike(block.content)) return block.content
  if (block.media?.title) return block.media.title
  if (block.media?.text) return block.media.text
  return ''
}
