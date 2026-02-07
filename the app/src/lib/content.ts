/**
 * CYPHE — Centralized content API
 *
 * Wikipedia first for topic graph. Supplement Wikipedia nodes with uhaccs (tweets, reddit, etc.).
 */

import type { ContentBlock, NextNode } from './types'
import { exploreTopic, expandTopic, expandTopicFast, getTransition, refineBranches } from './api'
import type { GraphNode } from './graph'
import { filterSmartLinks, filterSmartLinksLenient } from './linkFilter'

const API_BASE = '/api'

export interface ContentHealthResponse {
  status: string
  mock_mode?: boolean
  available_apis?: Record<string, boolean>
}

export interface ContentGraph {
  nodes: Array<{ id: string; label: string }>
  edges: Array<{ source: string; target: string }>
}

export interface ContentSessionState {
  visited_nodes: string[]
  graph: ContentGraph
  topic_path: string[]
  current_node: string
  last_paragraph: string
}

export interface TimeData {
  current_node_id: string
  total_time_on_node_ms: number
  scroll_events: number
  go_deeper_clicks: number
  sections_in_current_node: number
  time_per_section_ms: number
}

export interface ContentInitialResponse {
  content_blocks: ContentBlock[]
  next_nodes: NextNode[]
  graph?: ContentGraph
  strategy_used?: string
}

/** Fetch uhaccs media blocks for a topic (tweets, reddit, wikipedia images). Used to augment Wikipedia sections. */
export async function fetchSupplementalMedia(topic: string): Promise<ContentBlock[]> {
  const res = await contentFetch<ContentInitialResponse>('/initial', { topic })
  if (!res?.content_blocks?.length) return []
  return res.content_blocks.filter((b) => b.type !== 'text' && !!b.media)
}

/** Group blocks by group_id. Each group typically has 1 text + 1 media. */
export function groupBlocksByGroupId(blocks: ContentBlock[]): ContentBlock[][] {
  const byGroup = new Map<string, ContentBlock[]>()
  for (const b of blocks) {
    const gid = b.group_id || b.id
    if (!byGroup.has(gid)) byGroup.set(gid, [])
    byGroup.get(gid)!.push(b)
  }
  return Array.from(byGroup.values())
}

/** Check content API health. Call on site load to verify uhaccs is reachable. */
export async function checkContentHealth(): Promise<ContentHealthResponse | null> {
  try {
    const cypheRes = await fetch(`${API_BASE}/health`)
    if (!cypheRes.ok) {
      console.warn('[Cyphe] Cyphe API unreachable (is npm run api running on port 3001?)')
      return null
    }
    const contentRes = await fetch(`${API_BASE}/content/health`)
    if (!contentRes.ok) return null
    return contentRes.json()
  } catch {
    return null
  }
}

export interface ContentGenerateResponse {
  content_blocks: ContentBlock[]
  next_nodes: NextNode[]
  strategy_used?: string
  engagement_score?: number
}

async function contentFetch<T>(path: string, body: object): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}/content${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

/** Load initial content. Wikipedia first for topic graph; supplement with uhaccs (tweets, reddit, etc.) via fetchSupplementalMedia. */
export async function loadInitialContent(topic: string): Promise<{
  type: 'wikipedia'
  graph: { root: GraphNode }
  refineBranches: () => Promise<string[]>
}> {
  const graph = await exploreTopic(topic)
  return {
    type: 'wikipedia',
    graph,
    refineBranches: async () => {
      if (!graph.root.error && graph.root.rawLinks?.length) {
        return refineBranches(topic, graph.root.summary, graph.root.rawLinks, graph.root.title)
      }
      return []
    },
  }
}

/** Load next content. For content: pass sessionState, timeData, nextNode; for Wikipedia: pass branchTitle. */
export async function loadNextContent(
  currentItem: { type: 'content'; nodeId: string; contentBlocks: ContentBlock[] } | { type: 'wikipedia'; node: GraphNode },
  target: { type: 'content'; nextNode: NextNode } | { type: 'wikipedia'; branchTitle: string },
  sessionState: ContentSessionState,
  timeData: TimeData
): Promise<
  | { type: 'content'; contentBlocks: ContentBlock[]; nextNodes: NextNode[]; title: string; nodeId: string }
  | { type: 'wikipedia'; node: GraphNode; transition?: string }
  | null
> {
  if (currentItem.type === 'content' && target.type === 'content') {
    const gen = await contentFetch<ContentGenerateResponse>('/generate', {
      current_node: target.nextNode.label,
      time_data: {
        current_node_id: target.nextNode.id,
        total_time_on_node_ms: timeData.total_time_on_node_ms,
        scroll_events: timeData.scroll_events,
        go_deeper_clicks: timeData.go_deeper_clicks,
        sections_in_current_node: timeData.sections_in_current_node,
        time_per_section_ms: timeData.time_per_section_ms,
      },
      visited_nodes: sessionState.visited_nodes,
      last_paragraph: sessionState.last_paragraph,
      topic_path: sessionState.topic_path,
      graph: sessionState.graph,
    })
    if (!gen || !gen.content_blocks?.length) return null

    return {
      type: 'content',
      contentBlocks: gen.content_blocks,
      nextNodes: gen.next_nodes ?? [],
      title: target.nextNode.label,
      nodeId: target.nextNode.id,
    }
  }

  if (currentItem.type === 'wikipedia' && target.type === 'wikipedia') {
    const node = await expandTopic(target.branchTitle)
    return { type: 'wikipedia', node }
  }

  return null
}

/** Get transition text between two Wikipedia nodes */
export async function getWikipediaTransition(from: GraphNode, to: GraphNode): Promise<string> {
  return getTransition(from, to)
}

/** Expand a Wikipedia node (for graph navigation) */
export async function expandWikipediaNode(branchTitle: string): Promise<GraphNode> {
  return expandTopic(branchTitle)
}

/** Fast expand for graph preview (used by getTopLinksForTitle) */
export async function expandWikipediaFast(branchTitle: string): Promise<GraphNode | null> {
  return expandTopicFast(branchTitle)
}

/** Get unvisited next node from a content item */
export function pickNextContentNode(
  item: { nextNodes: NextNode[] },
  visitedIds: Set<string>
): NextNode | null {
  const unvisited = item.nextNodes.filter((n) => !visitedIds.has(n.id.toLowerCase()))
  return unvisited[0] ?? null
}

/** Get next Wikipedia branch from node and visited set */
export function pickNextWikipediaBranch(
  node: GraphNode,
  visited: Set<string>,
  getBestBranch: (candidates: string[]) => string | null
): string | null {
  const titles = node.branches.length > 0
    ? node.branches.map((b) => b.title)
    : (node.rawLinks ?? []).slice(0, 60)
  const unvisited = titles.filter((t) => !visited.has(t.trim().toLowerCase()))
  const candidates = filterSmartLinks(unvisited, 12)
  const fallback = candidates.length === 0 ? filterSmartLinksLenient(unvisited, 15) : candidates
  return getBestBranch(fallback.length > 0 ? fallback : [])
}
