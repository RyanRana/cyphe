const KEY = 'cyphe-session'

export function saveSession(state) {
  try {
    const toSave = {
      tab: state.tab,
      topic: state.topic,
      contentBlocks: state.contentBlocks,
      graph: state.graph,
      nextNodes: state.nextNodes,
      visitedNodes: state.visitedNodes,
      topicPath: state.topicPath,
      lastParagraph: state.lastParagraph,
      currentNodeId: state.currentNodeId,
      engagement: state.engagement,
    }
    localStorage.setItem(KEY, JSON.stringify(toSave))
  } catch {
    // localStorage full or unavailable
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data.topic) return null
    return data
  } catch {
    return null
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
