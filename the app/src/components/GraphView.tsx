import { useState, useEffect, useRef, useCallback } from 'react'
import * as d3 from 'd3'
import type { PersistedGraph, PersistedNode } from '../lib/explorationGraph'
import './GraphView.css'

const toId = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

interface VizNode {
  id: string
  title: string
  x: number
  y: number
  isPreview: boolean
  parentId?: string
  linkTitle?: string
}

interface VizLink {
  source: string
  target: string
}

interface GraphViewProps {
  graph: PersistedGraph
  getTopLinks: (nodeId: string) => string[]
  getTopLinksForTitle?: (title: string, parentNodeId?: string) => Promise<string[]>
  onClose: () => void
  onNavigateTo: (nodeId: string, linkTitle: string) => void
}

function getPathOrder(graph: PersistedGraph): string[] {
  const nodes = Object.keys(graph.nodes)
  if (nodes.length === 0) return []
  if (graph.edges.length === 0) return nodes

  const roots = new Set(nodes)
  graph.edges.forEach((e) => roots.delete(e.toId))
  const root = roots.size > 0 ? [...roots][0]! : graph.edges[0]!.fromId

  const order: string[] = [root]
  const byFrom = new Map<string, string[]>()
  graph.edges.forEach((e) => {
    const list = byFrom.get(e.fromId) || []
    list.push(e.toId)
    byFrom.set(e.fromId, list)
  })

  const seen = new Set<string>([root])
  let current = root
  while (byFrom.has(current)) {
    const next = byFrom.get(current)![0]!
    if (seen.has(next)) break
    seen.add(next)
    order.push(next)
    current = next
  }
  return order
}

const WIDTH = 900
const HEIGHT = 600
const NODE_R = 36

export default function GraphView({ graph, getTopLinks, getTopLinksForTitle, onClose, onNavigateTo }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<SVGGElement>(null)
  const simRef = useRef<d3.Simulation<VizNode, VizLink> | null>(null)
  const [nodes, setNodes] = useState<VizNode[]>([])
  const [links, setLinks] = useState<VizLink[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<VizNode | null>(null)
  const [expandingPreviewId, setExpandingPreviewId] = useState<string | null>(null)

  const buildGraph = useCallback(() => {
    const order = getPathOrder(graph)
    const nodeList = order.map((id) => graph.nodes[id]).filter(Boolean)
    if (nodeList.length === 0) return { nodes: [], links: [] }

    const centerX = WIDTH / 2
    const centerY = HEIGHT / 2
    const spread = 120

    const vizNodes: VizNode[] = order.map((id, i) => {
      const n = graph.nodes[id]!
      const angle = (i / Math.max(order.length - 1, 1)) * Math.PI * 0.6 - Math.PI * 0.3
      const r = 80 + Math.random() * 60
      return {
        id,
        title: n.title,
        x: centerX + Math.cos(angle) * r + (Math.random() - 0.5) * spread,
        y: centerY + Math.sin(angle) * r * 0.6 + (Math.random() - 0.5) * spread,
        isPreview: false,
      }
    })

    const vizLinks: VizLink[] = graph.edges.map((e) => ({ source: e.fromId, target: e.toId }))

    return { nodes: vizNodes, links: vizLinks }
  }, [graph])

  const expandNode = useCallback(
    (nodeId: string) => {
      const topLinks = getTopLinks(nodeId)
      if (topLinks.length === 0) return

      setNodes((prev) => {
        const parent = prev.find((n) => n.id === nodeId)
        if (!parent) return prev

        const newPreviews: VizNode[] = topLinks.map((title, i) => {
          const pid = `preview:${toId(title)}:${nodeId}`
          const angle = (i / topLinks.length) * Math.PI * 1.5 + Math.random() * 0.5
          const dist = 100 + Math.random() * 60
          return {
            id: pid,
            title,
            x: parent.x + Math.cos(angle) * dist + (Math.random() - 0.5) * 50,
            y: parent.y + Math.sin(angle) * dist + (Math.random() - 0.5) * 50,
            isPreview: true,
            parentId: nodeId,
            linkTitle: title,
          }
        })

        const keep = prev.filter((n) => !n.isPreview || n.parentId !== nodeId)
        return [...keep, ...newPreviews]
      })
      setLinks((prev) => {
        const keep = prev.filter((l) => {
          const s = typeof l.source === 'string' ? l.source : (l.source as VizNode).id
          const t = typeof l.target === 'string' ? l.target : (l.target as VizNode).id
          if (s !== nodeId) return true
          return !String(t).startsWith('preview:')  // keep main chain link to primary node
        })
        const newLinks: VizLink[] = topLinks.map((title) => ({
          source: nodeId,
          target: `preview:${toId(title)}:${nodeId}`,
        }))
        return [...keep, ...newLinks]
      })
      setExpandedIds((ids) => new Set([...ids, nodeId]))
    },
    [getTopLinks]
  )

  const expandNodeFromPreview = useCallback((parent: VizNode, topLinks: string[]) => {
    if (topLinks.length === 0) return

    setNodes((prev) => {
      const newPreviews: VizNode[] = topLinks.map((title, i) => {
        const pid = `preview:${toId(title)}:${parent.id}`
        const angle = (i / topLinks.length) * Math.PI * 1.5 + Math.random() * 0.5
        const dist = 100 + Math.random() * 60
        return {
          id: pid,
          title,
          x: parent.x + Math.cos(angle) * dist + (Math.random() - 0.5) * 50,
          y: parent.y + Math.sin(angle) * dist + (Math.random() - 0.5) * 50,
          isPreview: true,
          parentId: parent.id,
          linkTitle: title,
        }
      })

      const keep = prev.filter((n) => !n.isPreview || n.parentId !== parent.id)
      return [...keep, ...newPreviews]
    })
    setLinks((prev) => {
      const keep = prev.filter((l) => {
        const s = typeof l.source === 'string' ? l.source : (l.source as VizNode).id
        const t = typeof l.target === 'string' ? l.target : (l.target as VizNode).id
        if (s !== parent.id) return true
        return !String(t).startsWith('preview:')
      })
      const newLinks: VizLink[] = topLinks.map((title) => ({
        source: parent.id,
        target: `preview:${toId(title)}:${parent.id}`,
      }))
      return [...keep, ...newLinks]
    })
    setExpandedIds((ids) => new Set([...ids, parent.id]))
  }, [])

  const collapseNode = useCallback((nodeId: string) => {
    setNodes((prev) => prev.filter((n) => !n.isPreview || n.parentId !== nodeId))
    setLinks((prev) =>
      prev.filter((l) => {
        const s = typeof l.source === 'string' ? l.source : (l.source as VizNode).id
        const t = typeof l.target === 'string' ? l.target : (l.target as VizNode).id
        if (s !== nodeId) return true
        return !String(t).startsWith('preview:')  // keep main chain link
      })
    )
    setExpandedIds((ids) => {
      const next = new Set(ids)
      next.delete(nodeId)
      return next
    })
  }, [])

  useEffect(() => {
    const { nodes: n, links: l } = buildGraph()
    setNodes(n)
    setLinks(l)
    setExpandedIds(new Set())
  }, [buildGraph])

  useEffect(() => {
    const svg = svgRef.current
    const g = zoomRef.current
    if (!svg || !g) return

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .filter((ev) => !(ev.target as Element).closest?.('.graph-view-node-g'))
      .on('zoom', (ev) => {
        g.setAttribute('transform', ev.transform.toString())
      })

    d3.select(svg).call(zoom)
    return () => {
      d3.select(svg).on('.zoom', null)
    }
  }, [])

  useEffect(() => {
    if (nodes.length === 0) return

    const d3Nodes = nodes.map((n) => ({ ...n }))
    const d3Links = links
      .map((l) => {
        const sid = typeof l.source === 'string' ? l.source : (l.source as VizNode).id
        const tid = typeof l.target === 'string' ? l.target : (l.target as VizNode).id
        const src = d3Nodes.find((n) => n.id === sid)
        const tgt = d3Nodes.find((n) => n.id === tid)
        return src && tgt ? { source: src, target: tgt } : null
      })
      .filter((x): x is { source: VizNode; target: VizNode } => x != null)

    const sim = d3
      .forceSimulation<VizNode>(d3Nodes)
      .force('link', d3.forceLink<VizNode>(d3Links).id((d) => d.id).distance(110))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collision', d3.forceCollide().radius(NODE_R + 28).strength(0.9))
      .force('x', d3.forceX(WIDTH / 2).strength(0.015))
      .force('y', d3.forceY(HEIGHT / 2).strength(0.015))
      .alphaDecay(0.06)

    let raf = 0
    sim.on('tick', () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setNodes(d3Nodes.map((n) => ({ ...n })))
      })
    })
    sim.on('end', () => {
      if (raf) cancelAnimationFrame(raf)
      setNodes(d3Nodes.map((n) => ({ ...n })))
    })

    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [nodes.length, links.length])

  const handleNodeClick = (n: VizNode) => {
    setSelectedNode(n)
  }

  const handleExplore = () => {
    if (!selectedNode) return
    if (selectedNode.isPreview && selectedNode.parentId && selectedNode.linkTitle) {
      onNavigateTo(selectedNode.parentId, selectedNode.linkTitle)
    } else {
      onClose()
    }
    setSelectedNode(null)
  }

  const handleSeeMore = async () => {
    if (!selectedNode) return

    if (selectedNode.isPreview) {
      if (expandedIds.has(selectedNode.id)) {
        collapseNode(selectedNode.id)
        setSelectedNode(null)
        return
      }
      if (!getTopLinksForTitle || !selectedNode.linkTitle) {
        setSelectedNode(null)
        return
      }
      setExpandingPreviewId(selectedNode.id)
      try {
        const parentId = selectedNode.parentId
        const topLinks = await getTopLinksForTitle(selectedNode.linkTitle, parentId)
        if (topLinks.length > 0) expandNodeFromPreview(selectedNode, topLinks)
      } finally {
        setExpandingPreviewId(null)
        setSelectedNode(null)
      }
      return
    }

    if (expandedIds.has(selectedNode.id)) {
      collapseNode(selectedNode.id)
    } else {
      expandNode(selectedNode.id)
    }
    setSelectedNode(null)
  }

  if (nodes.length === 0 && Object.keys(graph.nodes).length === 0) return null

  const nodeById = (id: string) => nodes.find((n) => n.id === id)!

  return (
    <div className="graph-view-page" role="main" aria-label="Topics graph">
      <header className="graph-view-header">
        <h2 className="graph-view-title">Topics Explored</h2>
        <button type="button" className="graph-view-close" onClick={onClose} aria-label="Back to exploration">
          ← Back
        </button>
      </header>
      <div className="graph-view-canvas-wrapper">
        <svg
          ref={svgRef}
          className="graph-view-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
              <linearGradient id="orbGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
                <stop offset="50%" stopColor="rgba(235,233,228,0.9)" />
                <stop offset="100%" stopColor="rgba(210,208,202,0.95)" />
              </linearGradient>
              <filter id="orbShadow">
                <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.15" />
              </filter>
              <filter id="orbInner">
                <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur" />
              </filter>
            </defs>
            <g ref={zoomRef} className="graph-view-zoom">
              <g className="graph-view-links">
              {links.map((l, i) => {
                const src = nodeById(typeof l.source === 'string' ? l.source : (l.source as VizNode).id)
                const tgt = nodeById(typeof l.target === 'string' ? l.target : (l.target as VizNode).id)
                if (!src || !tgt) return null
                const midX = (src.x + tgt.x) / 2
                const midY = (src.y + tgt.y) / 2
                const dx = tgt.x - src.x
                const dy = tgt.y - src.y
                const perpX = -dy * 0.2
                const perpY = dx * 0.2
                const cpx = midX + perpX
                const cpy = midY + perpY
                const d = `M ${src.x} ${src.y} Q ${cpx} ${cpy} ${tgt.x} ${tgt.y}`
                return (
                  <path
                    key={`${src.id}-${tgt.id}-${i}`}
                    d={d}
                    className="graph-view-edge"
                    fill="none"
                  />
                )
              })}
            </g>
            <g className="graph-view-nodes">
              {nodes.map((n) => (
                <g
                  key={n.id}
                  className={`graph-view-node-g ${n.isPreview ? 'graph-view-node-g--preview' : ''}`}
                  transform={`translate(${n.x},${n.y})`}
                >
                  <circle
                    r={NODE_R}
                    className="graph-view-node-circle"
                    onClick={() => handleNodeClick(n)}
                    style={{ cursor: 'pointer' }}
                  />
                  <text
                    className="graph-view-node-label"
                    textAnchor="middle"
                    dy="0.35em"
                    onClick={() => handleNodeClick(n)}
                    style={{ cursor: 'pointer', pointerEvents: 'none' }}
                  >
                    {n.title.length > 20 ? n.title.slice(0, 18) + '…' : n.title}
                  </text>
                </g>
              ))}
            </g>
            </g>
          </svg>
      </div>
      {selectedNode && (
        <div className="graph-view-popover" role="dialog" aria-label="Node actions">
          <div className="graph-view-popover-backdrop" onClick={() => setSelectedNode(null)} aria-hidden="true" />
          <div className="graph-view-popover-content">
            <p className="graph-view-popover-title">{selectedNode.title}</p>
            <div className="graph-view-popover-actions">
              {(getTopLinksForTitle ? true : !selectedNode.isPreview) && (
                <button
                  type="button"
                  className="graph-view-popover-btn"
                  onClick={handleSeeMore}
                  disabled={selectedNode.isPreview && expandingPreviewId === selectedNode.id}
                >
                  {selectedNode.isPreview && expandingPreviewId === selectedNode.id
                    ? 'Loading…'
                    : expandedIds.has(selectedNode.id)
                      ? 'Collapse'
                      : 'See more nodes'}
                </button>
              )}
              <button type="button" className="graph-view-popover-btn graph-view-popover-btn--primary" onClick={handleExplore}>
                Explore
              </button>
            </div>
          </div>
        </div>
      )}
      <p className="graph-view-hint">Click a topic • Explore = go to feed • See more nodes = reveal connections</p>
    </div>
  )
}
