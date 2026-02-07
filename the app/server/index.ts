/**
 * CYPHE — API server for exploration graph + Claude transitions
 *
 * Run: npx tsx server/index.ts
 * Requires: ANTHROPIC_API_KEY for transitions (optional)
 */

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import {
  buildExplorationGraph,
  expandBranch,
  fetchNodeFast,
  refineBranchesWithLLM,
} from '../src/lib/graph'
import { generateTransition } from '../src/lib/claude'
import {
  getExploreCache,
  setExploreCache,
  getExpandCache,
  setExpandCache,
  getClaudeBranchSelection,
  setClaudeBranchSelection,
  getClaudeTransition,
  setClaudeTransition,
} from '../src/lib/cache'

const app = express()
app.use(cors())
app.use(express.json())

const UHACCS_URL = process.env.UHACCS_URL || 'http://127.0.0.1:5001'

/** Proxy GET to uhaccs (health check) */
async function proxyGetToUhaccs(path: string, res: express.Response): Promise<boolean> {
  try {
    const resp = await fetch(`${UHACCS_URL}/api${path}`)
    const data = await resp.json().catch(() => ({}))
    res.status(resp.status).json(data)
    return true
  } catch (err) {
    console.error('uhaccs proxy error:', err)
    return false
  }
}

/** Proxy POST to uhaccs content API (initial + generate) */
async function proxyToUhaccs(path: string, body: object, res: express.Response): Promise<boolean> {
  try {
    const resp = await fetch(`${UHACCS_URL}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    res.status(resp.status).json(data)
    return true
  } catch (err) {
    console.error('uhaccs proxy error:', err)
    return false
  }
}

/** Cyphe API health (no uhaccs) — verify server is reachable */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cyphe' })
})

/** Uhaccs content API health — proxied to uhaccs */
app.get('/api/content/health', async (_req, res) => {
  const ok = await proxyGetToUhaccs('/health', res)
  if (!ok) return res.status(503).json({ status: 'error', error: 'Content API unavailable' })
})

app.post('/api/content/initial', async (req, res) => {
  const { topic } = req.body
  if (!topic?.trim()) return res.status(400).json({ error: 'topic required' })
  const ok = await proxyToUhaccs('/initial', { topic: topic.trim() }, res)
  if (!ok) return res.status(503).json({ error: 'Content API unavailable' })
})

app.post('/api/content/generate', async (req, res) => {
  const { current_node, time_data, visited_nodes, last_paragraph, topic_path, graph } = req.body
  if (!time_data?.current_node_id) return res.status(400).json({ error: 'time_data.current_node_id required' })
  const ok = await proxyToUhaccs(
    '/generate',
    {
      current_node: current_node || '',
      time_data: time_data || {},
      visited_nodes: visited_nodes || [],
      last_paragraph: last_paragraph || '',
      topic_path: topic_path || [],
      graph: graph || { nodes: [], edges: [] },
    },
    res
  )
  if (!ok) return res.status(503).json({ error: 'Content API unavailable' })
})

/** Fast explore: Wikipedia + heuristic branches only (no Claude) */
app.post('/api/explore/fast', async (req, res) => {
  try {
    const { topic } = req.body
    if (!topic?.trim()) {
      return res.status(400).json({ error: 'Topic is required' })
    }
    const key = topic.trim()
    const cached = getExploreCache<{ root: unknown; path: string[] }>(key)
    if (cached) return res.json(cached)
    const root = await fetchNodeFast(key, true)
    const graph = { root, path: root.error ? [] : [root.title] }
    setExploreCache(key, graph)
    res.json(graph)
  } catch (err) {
    console.error('explore/fast error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

/** Refine branches with LLM (call in background after fast explore) */
app.post('/api/refine-branches', async (req, res) => {
  try {
    const { topic, summary, rawLinks, title, engagementContext } = req.body
    if (!topic?.trim() || !summary || !rawLinks) {
      return res.status(400).json({ error: 'topic, summary, rawLinks required' })
    }
    const key = topic.trim()
    // Skip cache when engagement context is provided (personalized results)
    if (!engagementContext) {
      const cached = getClaudeBranchSelection<string[]>(key)
      if (cached) return res.json({ branches: cached })
    }
    const branches = await refineBranchesWithLLM(summary, rawLinks, title || topic, engagementContext)
    if (branches.length > 0) setClaudeBranchSelection(key, branches)
    res.json({ branches })
  } catch (err) {
    console.error('refine-branches error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

/** Legacy full explore (Wikipedia + Claude, slower) */
app.post('/api/explore', async (req, res) => {
  try {
    const { topic } = req.body
    if (!topic?.trim()) {
      return res.status(400).json({ error: 'Topic is required' })
    }
    const graph = await buildExplorationGraph(topic.trim())
    res.json(graph)
  } catch (err) {
    console.error('explore error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

/** Fast expand: Wikipedia + heuristic only */
app.post('/api/expand/fast', async (req, res) => {
  try {
    const { branchTitle } = req.body
    if (!branchTitle?.trim()) {
      return res.status(400).json({ error: 'branchTitle is required' })
    }
    const key = branchTitle.trim()
    const cached = getExpandCache<unknown>(key)
    if (cached) return res.json(cached)
    const node = await fetchNodeFast(key)
    setExpandCache(key, node)
    res.json(node)
  } catch (err) {
    console.error('expand/fast error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/expand', async (req, res) => {
  try {
    const { branchTitle } = req.body
    if (!branchTitle?.trim()) {
      return res.status(400).json({ error: 'branchTitle is required' })
    }
    const node = await expandBranch('', branchTitle.trim())
    res.json(node)
  } catch (err) {
    console.error('expand error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/transition', async (req, res) => {
  try {
    const { from, to } = req.body
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to nodes required' })
    }
    const cached = getClaudeTransition<string>(from.title, to.title)
    if (cached) return res.json({ transition: cached })
    const text = await generateTransition(from, to)
    if (text) setClaudeTransition(from.title, to.title, text)
    res.json({ transition: text })
  } catch (err) {
    console.error('transition error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

/** Pexels image search (one photo per query) */
app.post('/api/pexels/search', async (req, res) => {
  try {
    const { query } = req.body
    if (!query?.trim()) {
      return res.status(400).json({ error: 'query is required' })
    }
    const apiKey = process.env.PEXELS_API_KEY
    if (!apiKey) {
      return res.status(503).json({ error: 'Pexels API key not configured' })
    }
    const page = Math.floor(Math.random() * 5) + 1
    const resp = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query.trim())}&per_page=15&page=${page}`,
      { headers: { Authorization: apiKey } }
    )
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'Pexels API error' })
    }
    const data = await resp.json()
    const photos = data.photos || []
    const photo = photos.length > 0 ? photos[Math.floor(Math.random() * photos.length)] : null
    if (!photo) {
      return res.json({ src: null, alt: null, photographer: null, url: null })
    }
    res.json({
      src: photo.src?.large || photo.src?.medium,
      alt: photo.alt || query,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      url: photo.url,
    })
  } catch (err) {
    console.error('pexels error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`CYPHE API running on http://localhost:${PORT}`)
}).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is in use. Stop the other process or set PORT=3002`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})
