export const initialState = {
  tab: 'explore',
  topic: null,
  contentBlocks: [],
  graph: { nodes: [], edges: [] },
  nextNodes: [],
  visitedNodes: [],
  topicPath: [],
  lastParagraph: '',
  currentNodeId: null,
  loading: false,
  error: null,
  engagement: { startTime: Date.now(), scrollCount: 0, clickCount: 0, sectionCount: 1 },
}

function mergeGraph(existing, incoming) {
  if (!incoming) return existing
  const nodeIds = new Set(existing.nodes.map((n) => n.id))
  const edgeKeys = new Set(existing.edges.map((e) => `${e.source}-${e.target}`))
  const nodes = [...existing.nodes]
  const edges = [...existing.edges]
  for (const n of incoming.nodes || []) {
    if (!nodeIds.has(n.id)) {
      nodes.push(n)
      nodeIds.add(n.id)
    }
  }
  for (const e of incoming.edges || []) {
    const key = `${e.source}-${e.target}`
    if (!edgeKeys.has(key)) {
      edges.push(e)
      edgeKeys.add(key)
    }
  }
  return { nodes, edges }
}

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, tab: action.tab }

    case 'SET_TOPIC':
      return { ...state, topic: action.topic, loading: true, error: null }

    case 'LOAD_INITIAL':
      return {
        ...state,
        contentBlocks: action.data.content_blocks,
        graph: action.data.graph || { nodes: [], edges: [] },
        nextNodes: action.data.next_nodes || [],
        visitedNodes: [],
        topicPath: [action.data.content_blocks?.[0]?.group_id ? state.topic : state.topic],
        lastParagraph: findLastText(action.data.content_blocks),
        currentNodeId: action.data.graph?.nodes?.[0]?.id || null,
        loading: false,
        error: null,
        engagement: { startTime: Date.now(), scrollCount: 0, clickCount: 0, sectionCount: countGroups(action.data.content_blocks) },
      }

    case 'APPEND_CONTENT':
      return {
        ...state,
        contentBlocks: [...state.contentBlocks, ...action.data.content_blocks],
        graph: mergeGraph(state.graph, action.graph),
        nextNodes: action.data.next_nodes || [],
        lastParagraph: findLastText(action.data.content_blocks),
        loading: false,
        error: null,
        engagement: {
          ...state.engagement,
          sectionCount: state.engagement.sectionCount + countGroups(action.data.content_blocks),
        },
      }

    case 'NAVIGATE_NODE': {
      const visited = state.currentNodeId
        ? [...state.visitedNodes, state.currentNodeId]
        : state.visitedNodes
      return {
        ...state,
        currentNodeId: action.nodeId,
        visitedNodes: visited,
        topicPath: [...state.topicPath, action.label],
        loading: true,
        error: null,
        engagement: { startTime: Date.now(), scrollCount: 0, clickCount: 0, sectionCount: 1 },
      }
    }

    case 'SET_LOADING':
      return { ...state, loading: action.loading }

    case 'SET_ERROR':
      return { ...state, error: action.error, loading: false }

    case 'TRACK_SCROLL':
      return { ...state, engagement: { ...state.engagement, scrollCount: state.engagement.scrollCount + 1 } }

    case 'TRACK_CLICK':
      return { ...state, engagement: { ...state.engagement, clickCount: state.engagement.clickCount + 1 } }

    case 'RESTORE_SESSION':
      return { ...action.state, loading: false, error: null }

    default:
      return state
  }
}

function findLastText(blocks) {
  if (!blocks) return ''
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text') return blocks[i].content
  }
  return ''
}

function countGroups(blocks) {
  if (!blocks) return 0
  return new Set(blocks.map((b) => b.group_id)).size
}
