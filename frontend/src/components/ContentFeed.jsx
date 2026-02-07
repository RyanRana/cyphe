import { useEffect, useRef, useMemo, useCallback } from 'react'
import ContentGroup from './ContentGroup'
import NextNodes from './NextNodes'

function RevealBlock({ children }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('visible')
          observer.unobserve(el)
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -40px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="reveal">
      {children}
    </div>
  )
}

export default function ContentFeed({ blocks, nextNodes, loading, onNavigateNode, onLoadMore, dispatch }) {
  const sentinelRef = useRef(null)
  const loadingRef = useRef(loading)
  loadingRef.current = loading

  // Track scroll events
  useEffect(() => {
    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(() => {
          dispatch({ type: 'TRACK_SCROLL' })
          ticking = false
        })
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [dispatch])

  // Infinite scroll: observe sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current) {
          onLoadMore()
        }
      },
      { rootMargin: '400px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore])

  // Group blocks by group_id preserving order
  const groups = useMemo(() => {
    const map = new Map()
    for (const block of blocks) {
      const gid = block.group_id
      if (!map.has(gid)) map.set(gid, [])
      map.get(gid).push(block)
    }
    return Array.from(map.entries())
  }, [blocks])

  if (groups.length === 0 && !loading) {
    return null
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="space-y-1">
        {groups.map(([groupId, groupBlocks]) => (
          <RevealBlock key={groupId}>
            <ContentGroup blocks={groupBlocks} />
          </RevealBlock>
        ))}
      </div>

      {/* Topic suggestions — always visible when available (even during loading) */}
      {nextNodes.length > 0 && (
        <RevealBlock>
          <NextNodes nodes={nextNodes} onNavigate={onNavigateNode} />
        </RevealBlock>
      )}

      {/* Loading spinner below the suggestions */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-12">
          <div className="w-10 h-10 rounded-full border-2 border-blue-500/20 border-t-blue-400 animate-spin" />
          <p className="text-sm text-gray-500">Generating content...</p>
        </div>
      )}

      <div ref={sentinelRef} className="h-1" />
    </div>
  )
}
