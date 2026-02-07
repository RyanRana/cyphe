/**
 * CYPHE — Node-based exploration graph persistence
 *
 * Saves all shown content as a graph (nodes + edges) to localStorage.
 * Used to ensure no revisiting of nodes across sessions.
 */

import type { GraphNode } from './graph'
import { filterSmartLinks } from './linkFilter'

const STORAGE_KEY = 'cyphe-exploration-graph'

function toId(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase()
}

export interface PersistedNode {
  id: string
  title: string
  summary: string
  teaser: string
  pageUrl: string
  branches: { title: string; teaser: string }[]
  rawLinks?: string[]
  timestamp: number
}

export interface PersistedEdge {
  fromId: string
  toId: string
  branchTitle: string
}

/** Convert PersistedNode to GraphNode for feed display */
export function persistedToGraphNode(p: PersistedNode): GraphNode {
  return {
    id: p.id,
    title: p.title,
    summary: p.summary,
    teaser: p.teaser,
    pageUrl: p.pageUrl,
    branches: p.branches.map((b) => ({ title: b.title, teaser: b.teaser })),
    rawLinks: p.rawLinks,
  }
}

export interface PersistedGraph {
  version: 1
  nodes: Record<string, PersistedNode>
  edges: PersistedEdge[]
}

function nodeToPersisted(node: GraphNode): PersistedNode {
  return {
    id: node.id,
    title: node.title,
    summary: node.summary,
    teaser: node.teaser,
    pageUrl: node.pageUrl,
    branches: node.branches.map((b) => ({ title: b.title, teaser: b.teaser })),
    rawLinks: node.rawLinks,
    timestamp: Date.now(),
  }
}

export class ExplorationGraph {
  private nodes = new Map<string, PersistedNode>()
  private edges: PersistedEdge[] = []
  private visitedTitles = new Set<string>()

  /** Add a node and optionally the edge from the previous node */
  addNode(node: GraphNode, prevNode?: GraphNode | null, branchTitle?: string): void {
    if (node.error) return

    const id = toId(node.title)
    const norm = normalizeTitle(node.title)

    this.visitedTitles.add(norm)
    this.nodes.set(id, nodeToPersisted(node))

    if (prevNode && branchTitle && !prevNode.error) {
      const fromId = toId(prevNode.title)
      this.edges.push({ fromId, toId: id, branchTitle })
    }
  }

  /** Check if a node (by title) has already been visited */
  hasVisited(title: string): boolean {
    return this.visitedTitles.has(normalizeTitle(title))
  }

  /** Get all visited titles (normalized) */
  getVisitedTitles(): Set<string> {
    return new Set(this.visitedTitles)
  }

  /** Path of node IDs from root to the given node */
  getPathToNode(nodeId: string): string[] {
    const order: string[] = []
    const nodes = Object.keys(this.getGraph().nodes)
    if (nodes.length === 0) return []
    const byFrom = new Map<string, string>()
    this.edges.forEach((e) => byFrom.set(e.toId, e.fromId))
    let curr: string | undefined = nodeId
    while (curr) {
      order.unshift(curr)
      curr = byFrom.get(curr)
    }
    return order
  }

  /** Top 3–5 connecting links for a node, excluding visited, filtered for quality */
  getTopLinksForNode(nodeId: string, max = 5): string[] {
    const n = this.nodes.get(nodeId)
    if (!n) return []
    const titles = n.branches.length > 0
      ? n.branches.map((b) => b.title)
      : (n.rawLinks ?? []).slice(0, 30)
    const unvisited = titles.filter((t) => !this.hasVisited(t))
    return filterSmartLinks(unvisited, max)
  }

  /** Get the full graph structure */
  getGraph(): PersistedGraph {
    const nodes: Record<string, PersistedNode> = {}
    this.nodes.forEach((v, k) => { nodes[k] = v })
    return {
      version: 1,
      nodes,
      edges: [...this.edges],
    }
  }

  /** Clear the graph (e.g. on new search) */
  clear(): void {
    this.nodes.clear()
    this.edges = []
    this.visitedTitles.clear()
  }

  toJSON(): string {
    return JSON.stringify(this.getGraph())
  }

  static fromJSON(json: string): ExplorationGraph {
    const g = new ExplorationGraph()
    try {
      const d: PersistedGraph = JSON.parse(json)
      if (d.version !== 1) return g
      Object.entries(d.nodes || {}).forEach(([id, n]) => {
        g.nodes.set(id, n)
        g.visitedTitles.add(normalizeTitle(n.title))
      })
      g.edges = d.edges || []
    } catch {
      /* return fresh graph */
    }
    return g
  }

  /** Persist to localStorage */
  save(): void {
    localStorage.setItem(STORAGE_KEY, this.toJSON())
  }

  /** Load from localStorage */
  static load(): ExplorationGraph {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? ExplorationGraph.fromJSON(saved) : new ExplorationGraph()
  }
}
