import { useState, useRef, useEffect, useCallback } from 'react'
import { getPexelsImage, type PexelsPhoto } from '../lib/api'
import type { GraphNode } from '../lib/graph'
import {
  type FeedItem,
  type WikipediaFeedItem,
  isWikipediaItem,
  isMediaBlock,
  isLinkMediaBlock,
  getMediaSourceLabel,
  getBlockDisplayContent,
} from '../lib/types'
import {
  loadInitialContent,
  checkContentHealth,
  fetchSupplementalMedia,
  expandWikipediaNode,
  expandWikipediaFast,
  getWikipediaTransition,
  pickNextWikipediaBranch,
} from '../lib/content'
import { EngagementTracker } from '../lib/engagement'
import { ExplorationGraph, persistedToGraphNode } from '../lib/explorationGraph'
import { filterSmartLinksLenient } from '../lib/linkFilter'
import GraphView from './GraphView'
import './Hero.css'

function truncateToSentences(text: string, max: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g)
  if (!sentences || sentences.length <= max) return text
  return sentences.slice(0, max).join('').trim()
}

/** Wraps last supplemental block; when visible in scroll area, reveals next from pending (load-on-seen) */
function SupplementalSentinel({
  children,
  onReveal,
  scrollRoot,
}: {
  children: React.ReactNode
  onReveal: () => void
  scrollRoot: HTMLElement | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const firedRef = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || firedRef.current) return
        firedRef.current = true
        onReveal()
      },
      { root: scrollRoot ?? undefined, rootMargin: '120px', threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [onReveal, scrollRoot])
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  )
}

export default function Hero() {
  const [query, setQuery] = useState('')
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [images, setImages] = useState<(PexelsPhoto | null)[]>([])
  const [loading, setLoading] = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [graphViewOpen, setGraphViewOpen] = useState(false)

  const feedRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const trackerRef = useRef(new EngagementTracker())
  const graphRef = useRef(ExplorationGraph.load())
  const graphViewOpenRef = useRef(false)
  const autoLoadGuard = useRef(false)
  const lastLoadTime = useRef(0)
  const autoLoadRef = useRef<() => Promise<void>>()

  const revealNextSupplemental = useCallback((itemIndex: number) => {
    setFeed((prev) => {
      const next = [...prev]
      const item = next[itemIndex]
      if (!item || !isWikipediaItem(item) || !item.supplementalPending?.length) return prev
      const [nextBlock, ...rest] = item.supplementalPending
      next[itemIndex] = {
        ...item,
        supplementalMedia: [...(item.supplementalMedia ?? []), nextBlock],
        supplementalPending: rest.length > 0 ? rest : undefined,
      }
      return next
    })
  }, [])

  // Health check on mount — verify content API is reachable
  useEffect(() => {
    checkContentHealth().then((health) => {
      if (health?.status === 'ok') console.log('[Cyphe] Content API OK', health.available_apis)
      else console.warn('[Cyphe] Content API unavailable, will use Wikipedia fallback')
    })
  }, [])

  // Load engagement state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('cyphe-engagement')
    if (saved) trackerRef.current = EngagementTracker.fromJSON(saved)

    return () => {
      trackerRef.current.finalizeNode(false)
      localStorage.setItem('cyphe-engagement', trackerRef.current.toJSON())
    }
  }, [])

  // Start tracking when a new Wikipedia node appears (no engagement tracking for uhaccs)
  useEffect(() => {
    if (feed.length === 0) return
    const last = feed[feed.length - 1]
    if (last && isWikipediaItem(last) && !last.node.error) {
      trackerRef.current.startTracking(last.node.id, last.node.title, (last.node.summary || last.node.teaser).length)
    }
    localStorage.setItem('cyphe-engagement', trackerRef.current.toJSON())
  }, [feed.length])

  // Track scroll + trigger infinite load when user nears bottom (one item at a time)
  const scrollThreshold = 400
  useEffect(() => {
    const el = feedRef.current
    if (!el || feed.length === 0) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      if (scrollHeight <= clientHeight) {
        autoLoadRef.current?.()
        return
      }
      trackerRef.current.updateScrollDepth(scrollTop / (scrollHeight - clientHeight))
      if (scrollTop + clientHeight >= scrollHeight - scrollThreshold) {
        autoLoadRef.current?.()
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [feed.length])

  const loadWikipediaNode = async (branchTitle: string, isManual: boolean) => {
    const lastItem = feed[feed.length - 1]
    const prevNode = lastItem && isWikipediaItem(lastItem) ? lastItem.node : undefined

    if (isManual) trackerRef.current.recordBranchClick(branchTitle)
    else trackerRef.current.finalizeNode(false)

    const node = await expandWikipediaNode(branchTitle)
    setFeed((prev) => [...prev, { source: 'wikipedia', node, transition: undefined }])
    graphRef.current.addNode(node, prevNode, branchTitle)
    graphRef.current.save()

    if (prevNode && !prevNode.error && !node.error) {
      getWikipediaTransition(prevNode, node).then((transition) => {
        if (transition) {
          setFeed((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && isWikipediaItem(last)) {
              next[next.length - 1] = { ...last, transition }
            }
            return next
          })
        }
      })
    }

    fetchSupplementalMedia(node.title).then((blocks) => {
      const [first, ...pending] = blocks.slice(0, 1)
      if (!first) return
      setFeed((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && isWikipediaItem(last)) {
          next[next.length - 1] = {
            ...last,
            supplementalMedia: [first],
            supplementalPending: pending.length > 0 ? pending : undefined,
          }
        }
        return next
      })
    })

    const newLen = feed.length + 1
    if (newLen >= 2 && newLen % 2 === 0 && prevNode) {
      getPexelsImage([prevNode.title, node.title].filter(Boolean).join(' ')).then((photo) => {
        if (photo?.src) setImages((prev) => [...prev, photo])
      })
    }

    if (!node.error && node.rawLinks?.length) {
      const ctx = trackerRef.current.getEngagementContext()
      const { refineBranches } = await import('../lib/api')
      refineBranches(branchTitle, node.summary, node.rawLinks, node.title, ctx).then((branches) => {
        if (branches.length > 0) {
          setFeed((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && isWikipediaItem(last)) {
              next[next.length - 1] = { ...last, node: { ...last.node, branches: branches.map((t) => ({ title: t, teaser: '' })) } }
            }
            return next
          })
        }
      })
    }
  }

  const loadNodeFromPath = async (pathFeedItems: WikipediaFeedItem[], linkTitle: string) => {
    const prevNode = pathFeedItems[pathFeedItems.length - 1]?.node
    const node = await expandWikipediaNode(linkTitle)
    setFeed([...pathFeedItems, { source: 'wikipedia', node, transition: undefined }])
    graphRef.current.addNode(node, prevNode, linkTitle)
    graphRef.current.save()

    if (prevNode && !prevNode.error && !node.error) {
      getWikipediaTransition(prevNode, node).then((transition) => {
        if (transition) {
          setFeed((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && isWikipediaItem(last)) {
              next[next.length - 1] = { ...last, transition }
            }
            return next
          })
        }
      })
    }

    fetchSupplementalMedia(node.title).then((blocks) => {
      const [first, ...pending] = blocks.slice(0, 1)
      if (!first) return
      setFeed((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && isWikipediaItem(last)) {
          next[next.length - 1] = {
            ...last,
            supplementalMedia: [first],
            supplementalPending: pending.length > 0 ? pending : undefined,
          }
        }
        return next
      })
    })
    if (pathFeedItems.length + 1 >= 2 && (pathFeedItems.length + 1) % 2 === 0) {
      getPexelsImage([prevNode?.title, node.title].filter(Boolean).join(' ')).then((photo) => {
        if (photo?.src) setImages((prev) => [...prev, photo])
      })
    }
    if (!node.error && node.rawLinks?.length) {
      const ctx = trackerRef.current.getEngagementContext()
      const { refineBranches } = await import('../lib/api')
      refineBranches(linkTitle, node.summary, node.rawLinks, node.title, ctx).then((branches) => {
        if (branches.length > 0) {
          setFeed((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && isWikipediaItem(last)) {
              next[next.length - 1] = { ...last, node: { ...last.node, branches: branches.map((t) => ({ title: t, teaser: '' })) } }
            }
            return next
          })
        }
      })
    }
  }

  const handleGraphNavigateTo = async (nodeId: string, linkTitle: string) => {
    setGraphViewOpen(false)

    const g = graphRef.current.getGraph()
    const pathIds = graphRef.current.getPathToNode(nodeId)
    const pathFeedItems: WikipediaFeedItem[] = pathIds.map((id) => ({
      source: 'wikipedia' as const,
      node: persistedToGraphNode(g.nodes[id]!),
      transition: undefined,
    }))
    graphRef.current.clear()
    pathIds.forEach((id, i) => {
      const node = persistedToGraphNode(g.nodes[id]!)
      const prev = i > 0 ? persistedToGraphNode(g.nodes[pathIds[i - 1]!]!) : null
      const edge = g.edges.find((e) => e.toId === id)
      graphRef.current.addNode(node, prev ?? undefined, edge?.branchTitle)
    })
    graphRef.current.save()
    setLoading(true)
    try {
      await loadNodeFromPath(pathFeedItems, linkTitle)
      lastLoadTime.current = Date.now()
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const term = query.trim()
    if (!term) return

    setLoading(true)
    setFeed([])
    setImages([])
    graphRef.current.clear()
    graphRef.current.save()
    autoLoadGuard.current = false

    try {
      const result = await loadInitialContent(term)
      setFeed([{ source: 'wikipedia', node: result.graph.root, transition: undefined }])
      graphRef.current.addNode(result.graph.root)
      graphRef.current.save()

      setLoading(false)
      lastLoadTime.current = 0
      requestAnimationFrame(() => feedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

      fetchSupplementalMedia(result.graph.root.title).then((blocks) => {
        const [first, ...pending] = blocks.slice(0, 1)
        if (!first) return
        setFeed((prev) => {
          const next = [...prev]
          const item = next[0]
          if (item && isWikipediaItem(item)) {
            next[0] = {
              ...item,
              supplementalMedia: [first],
              supplementalPending: pending.length > 0 ? pending : undefined,
            }
          }
          return next
        })
      })
      result.refineBranches().then((branches) => {
        if (branches.length > 0) {
          setFeed((prev) => {
            const next = [...prev]
            const item = next[0]
            if (item && isWikipediaItem(item)) {
              next[0] = { ...item, node: { ...item.node, branches: branches.map((t: string) => ({ title: t, teaser: '' })) } }
            }
            return next
          })
        }
      })
    } catch {
      setLoading(false)
    }
  }

  // --- Infinite scroll: auto-load next node via link-based chaining ---
  // Uses branches (LLM-refined) or rawLinks (Wikipedia links) to chain automatically
  // Never revisits: excludes any branch already in the feed

  const getNextWikipediaLink = (): string | null => {
    for (let i = feed.length - 1; i >= Math.max(0, feed.length - 6); i--) {
      const item = feed[i]
      if (!item || !isWikipediaItem(item) || item.node.error) continue
      const next = pickNextWikipediaBranch(
        item.node,
        graphRef.current.getVisitedTitles(),
        (candidates) => (candidates.length > 0 ? trackerRef.current.getBestAutoBranch(candidates) : null)
      )
      if (next) return next
    }
    return null
  }

  graphViewOpenRef.current = graphViewOpen

  const autoLoadNext = async () => {
    if (graphViewOpenRef.current || autoLoadGuard.current || loading || autoLoading) return
    if (lastLoadTime.current > 0 && Date.now() - lastLoadTime.current < 150) return

    if (feed.length === 0) return
    const lastItem = feed[feed.length - 1]
    if (!lastItem) return

    autoLoadGuard.current = true
    setAutoLoading(true)

    if (isWikipediaItem(lastItem) && !lastItem.node.error) {
      const next = getNextWikipediaLink()
      if (next) {
        setQuery(next)
        await loadWikipediaNode(next, false)
      }
    }

    setAutoLoading(false)
    autoLoadGuard.current = false
    lastLoadTime.current = Date.now()
  }

  autoLoadRef.current = autoLoadNext

  const _lastItem = feed[feed.length - 1]
  const lastBranchesLen = _lastItem && isWikipediaItem(_lastItem) ? _lastItem.node.branches?.length ?? 0 : 0
  const lastRawLinksLen = _lastItem && isWikipediaItem(_lastItem) ? _lastItem.node.rawLinks?.length ?? 0 : 0

  // Sentinel in view = user scrolled near bottom, load one more
  useEffect(() => {
    if (graphViewOpen || feed.length === 0) return
    const sentinel = sentinelRef.current
    const feedEl = feedRef.current
    if (!sentinel || !feedEl) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) autoLoadRef.current?.()
      },
      { root: feedEl, rootMargin: '600px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [graphViewOpen, feed.length, lastBranchesLen, lastRawLinksLen])

  const goToLanding = () => {
    trackerRef.current.finalizeNode(false)
    localStorage.setItem('cyphe-engagement', trackerRef.current.toJSON())
    graphRef.current.clear()
    graphRef.current.save()
    autoLoadGuard.current = false
    setFeed([])
  }

  const getTopLinksForTitle = async (title: string, parentNodeId?: string): Promise<string[]> => {
    const node = await expandWikipediaFast(title)
    if (!node || node.error) return []
    const graph = graphRef.current.getGraph()
    let prevNode: GraphNode | undefined
    if (parentNodeId) {
      const realId = parentNodeId.startsWith('preview:') ? parentNodeId.split(':').pop() : parentNodeId
      const p = graph.nodes[realId ?? '']
      if (p) prevNode = persistedToGraphNode(p)
    }
    graphRef.current.addNode(node, prevNode, title)
    graphRef.current.save()
    const links = graphRef.current.getTopLinksForNode(node.id, 8)
    if (links.length > 0) return links
    const titles = node.branches.length > 0 ? node.branches.map((b) => b.title) : (node.rawLinks ?? []).slice(0, 40)
    const visited = graphRef.current.getVisitedTitles()
    const unvisited = titles.filter((t) => !visited.has(t.trim().toLowerCase()))
    return filterSmartLinksLenient(unvisited, 8)
  }

  const graphHasNodes = Object.keys(graphRef.current.getGraph().nodes).length > 0

  // --- Graph view (separate page) ---
  if (feed.length > 0 && graphViewOpen && graphHasNodes) {
    return (
      <div className="graph-page">
        <GraphView
          graph={graphRef.current.getGraph()}
          getTopLinks={(id) => graphRef.current.getTopLinksForNode(id)}
          getTopLinksForTitle={getTopLinksForTitle}
          onClose={() => setGraphViewOpen(false)}
          onNavigateTo={handleGraphNavigateTo}
        />
      </div>
    )
  }

  // --- Results page ---
  if (feed.length > 0) {
    return (
      <div className="results-page">
        <header className="search-header">
          <div className="search-header-inner">
            <button type="button" className="search-brand search-brand-btn" onClick={goToLanding}>
              Cyphe
            </button>
            {graphHasNodes && (
            <button
              type="button"
              className="search-graph-btn"
              onClick={() => setGraphViewOpen(true)}
              aria-label="Show topics explored"
              title="Topics explored"
            >
              <svg className="search-graph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                <path d="m4.93 4.93 2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <span className="search-graph-label">Topics</span>
            </button>
            )}
            <form className="search-form" onSubmit={handleSubmit}>
              <div className="search-bar">
                <svg
                  className="search-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="search"
                  placeholder=""
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="search-input"
                  aria-label="Search"
                  disabled={loading}
                />
                <button type="submit" className="search-btn" disabled={loading}>
                  {loading ? '…' : 'Search'}
                </button>
              </div>
            </form>
          </div>
        </header>

        <div className="feed feed-document" ref={feedRef} role="article" aria-label="Knowledge exploration">
          <article className="feed-article">
            {feed.map((item, i) => (
              <section key={i} className="feed-section">
                {item.transition && <p className="feed-transition">{item.transition}</p>}
                {isWikipediaItem(item) ? (
                  item.node.error ? (
                    <p className="feed-error">{item.node.error}</p>
                  ) : (
                    <>
                      <div className="feed-content-block">
                        <p className="feed-summary">{truncateToSentences(item.node.summary || item.node.teaser, 2)}</p>
                      </div>
                      {item.supplementalMedia && item.supplementalMedia.length > 0 && (
                        <div className="feed-uhaccs-block feed-supplemental-media">
                          {item.supplementalMedia.map((block, bi) => {
                            const isLastWithPending =
                              bi === item.supplementalMedia!.length - 1 && item.supplementalPending?.length
                            const blockEl = (
                              <div key={block.id} className={`feed-uhaccs-item feed-uhaccs-item--${block.type}`}>
                                {isLinkMediaBlock(block) ? (
                                  <a
                                    href={block.media!.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="feed-uhaccs-link-card"
                                  >
                                    <span className="feed-uhaccs-link-content">
                                      {getBlockDisplayContent(block) || block.media!.url}
                                    </span>
                                    <span className="feed-uhaccs-link-source">{getMediaSourceLabel(block)}</span>
                                  </a>
                                ) : isMediaBlock(block) && block.media?.url ? (
                                  <figure className="feed-uhaccs-media">
                                    <img
                                      src={block.media.url}
                                      alt={block.media.alt_text ?? block.media.title ?? ''}
                                      loading="lazy"
                                    />
                                    <figcaption className="feed-uhaccs-source">
                                      {getMediaSourceLabel(block)}
                                      {block.media.title && ` — ${block.media.title}`}
                                    </figcaption>
                                  </figure>
                                ) : null}
                              </div>
                            )
                            return isLastWithPending ? (
                              <SupplementalSentinel
                                key={block.id}
                                onReveal={() => revealNextSupplemental(i)}
                                scrollRoot={feedRef.current}
                              >
                                {blockEl}
                              </SupplementalSentinel>
                            ) : (
                              blockEl
                            )
                          })}
                        </div>
                      )}
                    </>
                  )
                ) : null}
                {isWikipediaItem(item) && i % 2 === 1 && images[Math.floor(i / 2)]?.src && (
                  <figure className="feed-pexels-image">
                    <img src={images[Math.floor(i / 2)]!.src!} alt={images[Math.floor(i / 2)]!.alt || ''} loading="lazy" />
                    <figcaption>
                      Photo by{' '}
                      <a href={images[Math.floor(i / 2)]!.photographerUrl || images[Math.floor(i / 2)]!.url || 'https://www.pexels.com'} target="_blank" rel="noopener noreferrer">
                        {images[Math.floor(i / 2)]!.photographer}
                      </a>{' '}
                      on{' '}
                      <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">
                        Pexels
                      </a>
                    </figcaption>
                  </figure>
                )}
              </section>
            ))}
          </article>
          <div ref={sentinelRef} className="feed-sentinel">
            {autoLoading && <div className="feed-auto-loading">...</div>}
          </div>
        </div>
      </div>
    )
  }

  // --- Landing page ---

  return (
    <section className="hero hero-landing">
      <div className="hero-video-wrapper">
        <video className="hero-video" autoPlay muted loop playsInline>
          <source src="/andeanvideo.mp4" type="video/mp4" />
        </video>
        <div className="hero-overlay" />
        <div className="hero-grain" aria-hidden="true" />
      </div>

      <div className="hero-content">
        <h1 className="hero-brand">Cyphe</h1>

        <form className="hero-search" onSubmit={handleSubmit}>
          <div className="search-bar">
            <svg
              className="search-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder=""
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="search-input"
              aria-label="Search"
              disabled={loading}
            />
            <button type="submit" className="search-btn" disabled={loading}>
              {loading ? '…' : 'Search'}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
