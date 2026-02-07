const BASE = ''

async function request(url, options = {}) {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function fetchInitial(topic) {
  return request('/api/initial', {
    method: 'POST',
    body: JSON.stringify({ topic }),
  })
}

export function fetchGenerate({ currentNode, timeData, visitedNodes, lastParagraph, topicPath, graph }) {
  return request('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      current_node: currentNode,
      time_data: timeData,
      visited_nodes: visitedNodes || [],
      last_paragraph: lastParagraph || '',
      topic_path: topicPath || [],
      graph: graph || null,
    }),
  })
}

export function fetchHealth() {
  return request('/api/health')
}
