/**
 * CYPHE — API client for exploration
 *
 * Fast path: heuristic first, LLM in background.
 * Falls back to client-side when API unavailable.
 */

import {
  buildExplorationGraphFast,
  expandBranch,
  type ExplorationGraph,
  type GraphNode,
} from './graph'

const API_BASE = '/api'

async function apiPost<T>(path: string, body: object): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
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

/** Fast explore: Wikipedia + heuristic only. Use refineBranches in background. */
export async function exploreTopicFast(topic: string): Promise<ExplorationGraph | null> {
  return apiPost<ExplorationGraph>('/explore/fast', { topic })
}

/** Refine branches with LLM (call in background) */
export async function refineBranches(
  topic: string,
  summary: string,
  rawLinks: string[],
  title: string,
  engagementContext?: string
): Promise<string[]> {
  const res = await apiPost<{ branches: string[] }>('/refine-branches', {
    topic,
    summary,
    rawLinks,
    title,
    engagementContext,
  })
  return res?.branches ?? []
}

/** Explore a topic — fast path with fallback */
export async function exploreTopic(topic: string): Promise<ExplorationGraph> {
  const fast = await exploreTopicFast(topic)
  if (fast?.root) return fast
  return buildExplorationGraphFast(topic)
}

/** Fast expand: heuristic only. Use getTransition in background. */
export async function expandTopicFast(branchTitle: string): Promise<GraphNode | null> {
  return apiPost<GraphNode>('/expand/fast', { branchTitle })
}

/** Expand a branch — fast path with fallback */
export async function expandTopic(branchTitle: string): Promise<GraphNode> {
  const fast = await expandTopicFast(branchTitle)
  if (fast) return fast
  return expandBranch('', branchTitle)
}

/** Get transition text (call in background after showing node) */
export async function getTransition(from: GraphNode, to: GraphNode): Promise<string> {
  const res = await apiPost<{ transition: string }>('/transition', { from, to })
  return res?.transition ?? ''
}

export interface PexelsPhoto {
  src: string | null
  alt: string | null
  photographer: string | null
  photographerUrl?: string | null
  url: string | null
}

/** Search Pexels for one image (used after every 2 topics) */
export async function getPexelsImage(query: string): Promise<PexelsPhoto | null> {
  return apiPost<PexelsPhoto>('/pexels/search', { query })
}
