import { useReducer, useEffect, useCallback } from 'react'
import { reducer, initialState } from './state'
import { saveSession, loadSession, clearSession } from './storage'
import { fetchInitial, fetchGenerate } from './api'
import SearchBar from './components/SearchBar'
import ContentFeed from './components/ContentFeed'
import GraphView from './components/GraphView'

const SUGGESTIONS = ['Black Holes', 'CRISPR', 'Quantum Computing', 'Deep Ocean', 'Consciousness', 'Dark Matter']

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState, () => {
    const saved = loadSession()
    if (saved) return { ...initialState, ...saved, loading: false, error: null }
    return initialState
  })

  useEffect(() => {
    if (state.topic) saveSession(state)
  }, [state])

  const handleSearch = useCallback(async (topic) => {
    dispatch({ type: 'SET_TOPIC', topic })
    try {
      const data = await fetchInitial(topic)
      dispatch({ type: 'LOAD_INITIAL', data })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message })
    }
  }, [])

  const handleNavigateNode = useCallback(async (nodeId, label) => {
    dispatch({ type: 'NAVIGATE_NODE', nodeId, label })
    dispatch({ type: 'TRACK_CLICK' })
    try {
      const timeData = buildTimeData(state)
      const data = await fetchGenerate({
        currentNode: nodeId,
        timeData,
        visitedNodes: [...state.visitedNodes, state.currentNodeId].filter(Boolean),
        lastParagraph: state.lastParagraph,
        topicPath: [...state.topicPath, label],
        graph: state.graph,
      })
      const newEdges = state.currentNodeId ? [{ source: state.currentNodeId, target: nodeId }] : []
      const newNodes = data.next_nodes?.map((n) => ({ id: n.id, label: n.label })) || []
      dispatch({
        type: 'APPEND_CONTENT',
        data,
        graph: { nodes: [{ id: nodeId, label }, ...newNodes], edges: newEdges },
      })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message })
    }
  }, [state])

  const handleLoadMore = useCallback(async () => {
    if (state.loading || !state.currentNodeId) return
    dispatch({ type: 'SET_LOADING', loading: true })
    try {
      const timeData = buildTimeData(state)
      const data = await fetchGenerate({
        currentNode: state.currentNodeId,
        timeData,
        visitedNodes: state.visitedNodes,
        lastParagraph: state.lastParagraph,
        topicPath: state.topicPath,
        graph: state.graph,
      })
      const newNodes = data.next_nodes?.map((n) => ({ id: n.id, label: n.label })) || []
      dispatch({ type: 'APPEND_CONTENT', data, graph: { nodes: newNodes, edges: [] } })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message })
    }
  }, [state])

  const handleGraphNodeClick = useCallback((nodeId) => {
    const node = state.graph.nodes.find((n) => n.id === nodeId)
    if (node) {
      dispatch({ type: 'SET_TAB', tab: 'explore' })
      handleNavigateNode(nodeId, node.label)
    }
  }, [state.graph.nodes, handleNavigateNode])

  const handleReset = useCallback(() => {
    clearSession()
    dispatch({ type: 'RESTORE_SESSION', state: { ...initialState } })
  }, [])

  // Landing page
  if (!state.topic) {
    return (
      <div className="min-h-screen hero-bg noise relative flex flex-col items-center justify-center px-6">
        <div className="relative z-10 w-full max-w-2xl text-center">
          {/* Logo + Title */}
          <div className="animate-fade-up mb-3">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                  <path d="M2 12h20" />
                </svg>
              </div>
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
              <span className="gradient-text">Cyphe</span>
            </h1>
          </div>

          <p className="animate-fade-up-delay-1 text-lg text-gray-400 mb-10 max-w-md mx-auto leading-relaxed">
            Infinite AI-powered knowledge exploration with real sources.
          </p>

          {/* Search */}
          <div className="animate-fade-up-delay-2 mb-8">
            <SearchBar onSearch={handleSearch} loading={state.loading} />
          </div>

          {/* Quick suggestions */}
          <div className="animate-fade-up-delay-3 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSearch(s)}
                disabled={state.loading}
                className="px-3.5 py-1.5 text-sm text-gray-400 bg-gray-800/50 border border-gray-700/50 rounded-full hover:border-blue-500/40 hover:text-blue-400 hover:bg-blue-500/5 transition-all duration-200 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          {state.error && (
            <div className="mt-6 px-4 py-3 bg-red-950/30 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {state.error}
            </div>
          )}
        </div>

        {/* Subtle footer */}
        <div className="absolute bottom-6 text-gray-600 text-xs">
          Powered by AI + real scientific sources
        </div>
      </div>
    )
  }

  // Main app view
  return (
    <div className="min-h-screen noise relative flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-gray-800/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          {/* Top row: logo + search + tabs */}
          <div className="flex items-center gap-3 h-14">
            <button
              onClick={handleReset}
              className="shrink-0 flex items-center gap-2 group"
            >
              <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center group-hover:bg-blue-500/25 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                  <path d="M2 12h20" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-gray-300 group-hover:text-white transition-colors hidden sm:block">Cyphe</span>
            </button>

            <SearchBar onSearch={handleSearch} loading={state.loading} compact />

            <nav className="flex shrink-0 bg-gray-800/40 rounded-lg p-0.5">
              <TabButton active={state.tab === 'explore'} onClick={() => dispatch({ type: 'SET_TAB', tab: 'explore' })}>
                Explore
              </TabButton>
              <TabButton active={state.tab === 'graph'} onClick={() => dispatch({ type: 'SET_TAB', tab: 'graph' })}>
                Graph
                {state.graph.nodes.length > 0 && (
                  <span className="ml-1.5 text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">
                    {state.graph.nodes.length}
                  </span>
                )}
              </TabButton>
            </nav>
          </div>

          {/* Breadcrumb trail */}
          {state.topicPath.length > 0 && state.tab === 'explore' && (
            <div className="flex items-center gap-1 pb-2 -mt-1 overflow-x-auto text-xs scrollbar-none">
              {state.topicPath.map((name, i) => (
                <span key={i} className="flex items-center shrink-0">
                  {i > 0 && <span className="text-gray-700 mx-1.5">/</span>}
                  <span className={i === state.topicPath.length - 1 ? 'text-blue-400 font-medium' : 'text-gray-500'}>
                    {name}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 relative z-10">
        {state.error && (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4">
            <div className="px-4 py-3 bg-red-950/30 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {state.error}
            </div>
          </div>
        )}
        {state.tab === 'explore' ? (
          <ContentFeed
            blocks={state.contentBlocks}
            nextNodes={state.nextNodes}
            loading={state.loading}
            onNavigateNode={handleNavigateNode}
            onLoadMore={handleLoadMore}
            dispatch={dispatch}
          />
        ) : (
          <GraphView
            graph={state.graph}
            currentNodeId={state.currentNodeId}
            visitedNodes={state.visitedNodes}
            onNodeClick={handleGraphNodeClick}
          />
        )}
      </main>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 flex items-center ${
        active
          ? 'bg-blue-500/15 text-blue-400 shadow-sm shadow-blue-500/10'
          : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

function buildTimeData(state) {
  const elapsed = Date.now() - (state.engagement.startTime || Date.now())
  const sections = state.engagement.sectionCount || 1
  return {
    current_node_id: state.currentNodeId || '',
    total_time_on_node_ms: elapsed,
    scroll_events: state.engagement.scrollCount || 0,
    go_deeper_clicks: state.engagement.clickCount || 0,
    sections_in_current_node: sections,
    time_per_section_ms: sections > 0 ? Math.round(elapsed / sections) : 0,
  }
}
