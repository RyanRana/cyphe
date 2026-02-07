/**
 * CYPHE — Graph-based exploration builder
 *
 * Builds a JSON graph from a scientific topic:
 * - Root: Wikipedia summary + smart branches (not alphabetical)
 * - Each branch: 1-sentence teaser
 * - Ready for LLM transitions
 */

import { getWikipediaNode, searchAndFetchRoot } from './wikipedia'
import { selectBranchesWithLLM } from './claude'

// --- Types -------------------------------------------------------------------

export interface GraphNode {
  id: string
  title: string
  teaser: string /** 1-sentence summary */
  summary: string /** Full intro for context */
  pageUrl: string
  branches: GraphBranch[]
  rawLinks?: string[] /** For refineBranches in background */
  error?: string
}

export interface GraphBranch {
  title: string
  teaser: string
  /** Populated when branch is expanded */
  node?: GraphNode
}

export interface ExplorationGraph {
  root: GraphNode
  /** Path taken so far (for narrative continuity) */
  path: string[]
}

/** Sanitize string for use as ID */
function toId(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

/** Derive 1-sentence teaser from full summary */
function deriveTeaser(summary: string): string {
  const first = summary.split('.')[0]?.trim()
  return first ? first + '.' : summary.slice(0, 200) + (summary.length > 200 ? '…' : '')
}

/**
 * Fetches a topic and returns a graph node.
 * Uses heuristic branches first for fast display; LLM branches can be refined async.
 */
async function fetchNodeWithTeasers(
  topic: string,
  options?: { skipLLM?: boolean; isRoot?: boolean }
): Promise<GraphNode> {
  const full = options?.isRoot
    ? await searchAndFetchRoot(topic)
    : await getWikipediaNode(topic, false)

  if (full.error) {
    return {
      id: toId(topic),
      title: topic,
      teaser: '',
      summary: '',
      pageUrl: '',
      branches: [],
      error: full.error,
    }
  }

  const teaser = deriveTeaser(full.summary)

  // Heuristic branches first (fast); LLM refines in background when not skipped
  let branchTitles = full.branches
  if (!options?.skipLLM) {
    const llmBranches = await selectBranchesWithLLM(
      full.summary,
      full.rawLinks || [],
      full.title
    )
    if (llmBranches.length > 0) branchTitles = llmBranches
  }

  const branches: GraphBranch[] = branchTitles.map((title) => ({
    title,
    teaser: '',
  }))

  return {
    id: toId(full.title),
    title: full.title,
    teaser,
    summary: full.summary,
    pageUrl: full.pageUrl,
    branches,
    rawLinks: full.rawLinks,
  }
}

/**
 * Returns heuristic branches only (for fast first render).
 * Call refineBranchesWithLLM in background to get better branches.
 */
export async function fetchNodeFast(topic: string, isRoot = false): Promise<GraphNode> {
  return fetchNodeWithTeasers(topic, { skipLLM: true, isRoot })
}

/**
 * Refines branches for a node using LLM. Call in background after showing heuristic.
 */
export async function refineBranchesWithLLM(
  summary: string,
  rawLinks: string[],
  title: string,
  engagementContext?: string
): Promise<string[]> {
  return selectBranchesWithLLM(summary, rawLinks, title, engagementContext)
}

/**
 * Builds the exploration graph for a topic (fast: heuristic only).
 */
export async function buildExplorationGraphFast(topic: string): Promise<ExplorationGraph> {
  const root = await fetchNodeFast(topic, true)
  return {
    root,
    path: root.error ? [] : [root.title],
  }
}

/**
 * Builds the exploration graph for a topic (full: includes LLM branches).
 */
export async function buildExplorationGraph(topic: string): Promise<ExplorationGraph> {
  const root = await fetchNodeWithTeasers(topic)
  return {
    root,
    path: root.error ? [] : [root.title],
  }
}

/**
 * Expands a branch: fetches its full node + 1-sentence teasers for its branches.
 * Use when user clicks a branch to load the next level.
 */
export async function expandBranch(parentTitle: string, branchTitle: string): Promise<GraphNode> {
  return fetchNodeWithTeasers(branchTitle)
}
