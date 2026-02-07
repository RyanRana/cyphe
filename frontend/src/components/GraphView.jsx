import { useRef, useCallback, useMemo, useEffect } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

export default function GraphView({ graph, currentNodeId, visitedNodes, onNodeClick }) {
  const fgRef = useRef()
  const visitedSet = useMemo(() => new Set(visitedNodes || []), [visitedNodes])

  const graphData = useMemo(() => {
    if (!graph || !graph.nodes.length) return { nodes: [], links: [] }
    return {
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    }
  }, [graph])

  useEffect(() => {
    if (fgRef.current && currentNodeId) {
      const node = graphData.nodes.find((n) => n.id === currentNodeId)
      if (node && node.x != null) {
        fgRef.current.centerAt(node.x, node.y, 500)
      }
    }
  }, [currentNodeId, graphData.nodes])

  const handleNodeClick = useCallback((node) => {
    if (onNodeClick) onNodeClick(node.id)
  }, [onNodeClick])

  if (!graph || !graph.nodes.length) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] text-gray-500 gap-3">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-gray-700">
          <circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/>
          <path d="M5 8v2a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V8"/><path d="M12 14v2"/>
        </svg>
        <p className="text-sm">Explore a topic to start building the knowledge graph</p>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-56px)] w-full relative">
      {/* Legend */}
      <div className="absolute top-4 left-4 z-10 glass rounded-lg px-3 py-2 border border-gray-800/40 flex items-center gap-4 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50" />
          Current
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-500" />
          Visited
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
          Unvisited
        </span>
      </div>

      {/* Node count */}
      <div className="absolute top-4 right-4 z-10 glass rounded-lg px-3 py-2 border border-gray-800/40 text-[11px] text-gray-400">
        {graph.nodes.length} nodes &middot; {graph.edges.length} connections
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        nodeLabel={(n) => n.label || n.id}
        nodeRelSize={5}
        linkColor={() => 'rgba(55, 65, 81, 0.6)'}
        linkWidth={1}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={() => 'rgba(96, 165, 250, 0.3)'}
        backgroundColor="#030712"
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const isCurrent = node.id === currentNodeId
          const isVisited = visitedSet.has(node.id)
          const r = isCurrent ? 6 : 4.5

          // Glow for current
          if (isCurrent) {
            ctx.beginPath()
            ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI)
            ctx.fillStyle = 'rgba(96, 165, 250, 0.12)'
            ctx.fill()
          }

          // Node circle
          ctx.beginPath()
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
          ctx.fillStyle = isCurrent ? '#60a5fa' : isVisited ? '#6b7280' : '#d1d5db'
          ctx.fill()

          if (isCurrent) {
            ctx.strokeStyle = 'rgba(96, 165, 250, 0.5)'
            ctx.lineWidth = 1.5
            ctx.stroke()
          }

          // Label
          const label = node.label || node.id
          const fontSize = Math.max(11 / globalScale, 2.5)
          ctx.font = `${isCurrent ? '600' : '400'} ${fontSize}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = isCurrent ? '#93c5fd' : isVisited ? '#6b7280' : '#9ca3af'
          ctx.fillText(label, node.x, node.y + r + 3)
        }}
        nodeCanvasObjectMode={() => 'replace'}
      />
    </div>
  )
}
