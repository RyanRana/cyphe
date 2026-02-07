/**
 * CYPHE — Engagement-based recommendation engine
 *
 * Tracks user interactions per node and uses engagement patterns
 * to recommend branches. Feeds context to Claude for smarter picks.
 *
 * Scoring trade-offs:
 * - Time-based: Simple but penalizes slow readers. We normalize by expected reading time.
 * - Scroll-based: Good signal for interest but doesn't capture re-reading. We use max depth.
 * - Click-based: Strongest intent signal but binary. Weighted most heavily (35%).
 * - Fast-scroll penalty: Catches disinterest but might penalize skimming. Gentle 10% weight.
 */

export interface NodeInteraction {
  nodeId: string
  title: string
  timeSpent: number      // seconds viewing this node
  scrollDepth: number    // 0–1, how far user scrolled through content
  clickedBranch: boolean // whether user clicked a branch from this node
  fastScrolled: boolean  // whether user fast-scrolled past content
  branchClicked?: string // which specific branch title was clicked
  contentLength: number  // character count of node content
  timestamp: number
}

export interface EngagementScore {
  nodeId: string
  title: string
  rawScore: number       // 0–1+ composite engagement score
  interactions: number   // total views of this node
  avgTimeSpent: number
  avgScrollDepth: number
  clickRate: number      // fraction of views that led to a branch click
}

// --- Thresholds & constants ---

/** Above this score, the user is deeply engaged with a topic */
const HIGH_ENGAGEMENT = 0.7

/** Expected reading speed: ~33 chars/sec (relaxed reading, ~1000 chars in 30s) */
const CHARS_PER_SECOND = 33

/** If user spends less than 20% of expected time, they fast-scrolled */
const FAST_SCROLL_RATIO = 0.2

export class EngagementTracker {
  private interactions = new Map<string, NodeInteraction[]>()
  private scores = new Map<string, EngagementScore>()

  /** The node currently being viewed */
  private active: {
    nodeId: string
    title: string
    startTime: number
    scrollDepth: number
    contentLength: number
  } | null = null

  // ---- Recording interactions ----

  /**
   * Start tracking a node view. Call when a node becomes the active/visible node.
   * Automatically finalizes any previously active node.
   */
  startTracking(nodeId: string, title: string, contentLength: number): void {
    if (this.active && this.active.nodeId !== nodeId) {
      this.finalizeNode(false)
    }
    this.active = { nodeId, title, startTime: Date.now(), scrollDepth: 0, contentLength }
  }

  /**
   * Update scroll depth for the active node (0–1).
   * Only increases; tracks the maximum depth reached.
   */
  updateScrollDepth(depth: number): void {
    if (this.active) {
      this.active.scrollDepth = Math.max(this.active.scrollDepth, Math.min(depth, 1))
    }
  }

  /**
   * Record that a branch was clicked from the current node.
   * Finalizes the node with clickedBranch = true.
   */
  recordBranchClick(branchTitle: string): void {
    this.finalizeNode(true, branchTitle)
  }

  /**
   * Finalize tracking for the active node.
   * Stores the interaction and recalculates the engagement score.
   */
  finalizeNode(clickedBranch = false, branchClicked?: string): void {
    if (!this.active) return

    const { nodeId, title, startTime, scrollDepth, contentLength } = this.active
    const timeSpent = (Date.now() - startTime) / 1000
    const expectedTime = contentLength / CHARS_PER_SECOND
    const fastScrolled = expectedTime > 2 && timeSpent < expectedTime * FAST_SCROLL_RATIO

    const interaction: NodeInteraction = {
      nodeId, title, timeSpent, scrollDepth, clickedBranch,
      fastScrolled, branchClicked, contentLength, timestamp: Date.now(),
    }

    const list = this.interactions.get(nodeId) || []
    list.push(interaction)
    this.interactions.set(nodeId, list)
    this.recalcScore(nodeId, title, list)
    this.active = null
  }

  // ---- Scoring ----

  /**
   * Recalculate composite engagement score from all interactions for a node.
   *
   * Weights:
   *   30% — time spent (normalized to expected reading time)
   *   25% — scroll depth (how much of the content they saw)
   *   35% — click rate (did they click a branch — strongest signal)
   *   10% — inverse fast-scroll rate (penalty for skimming)
   */
  private recalcScore(nodeId: string, title: string, list: NodeInteraction[]): void {
    const n = list.length
    const avgTime = list.reduce((s, i) => s + i.timeSpent, 0) / n
    const avgScroll = list.reduce((s, i) => s + i.scrollDepth, 0) / n
    const clickRate = list.filter((i) => i.clickedBranch).length / n
    const fastRate = list.filter((i) => i.fastScrolled).length / n

    const avgContentLen = list.reduce((s, i) => s + i.contentLength, 0) / n
    const expectedTime = Math.max(avgContentLen / CHARS_PER_SECOND, 3)
    const timeScore = Math.min(avgTime / expectedTime, 1.0)

    const rawScore =
      timeScore * 0.3 +
      avgScroll * 0.25 +
      clickRate * 0.35 +
      (1 - fastRate) * 0.1

    this.scores.set(nodeId, {
      nodeId, title, rawScore, interactions: n,
      avgTimeSpent: avgTime, avgScrollDepth: avgScroll, clickRate,
    })
  }

  // ---- Querying ----

  getScore(nodeId: string): EngagementScore | undefined {
    return this.scores.get(nodeId)
  }

  isHighEngagement(nodeId: string): boolean {
    return (this.scores.get(nodeId)?.rawScore ?? 0) > HIGH_ENGAGEMENT
  }

  getAverageEngagement(): number {
    if (this.scores.size === 0) return 0.5
    return Array.from(this.scores.values()).reduce((s, e) => s + e.rawScore, 0) / this.scores.size
  }

  /** Titles of the top-N most engaged nodes */
  getTopEngagedTopics(count = 3): string[] {
    return Array.from(this.scores.values())
      .sort((a, b) => b.rawScore - a.rawScore)
      .slice(0, count)
      .map((s) => s.title)
  }

  /** Whether the user prefers depth (high engagement) or breadth (low engagement) */
  getUserPreference(): 'deep' | 'broad' | 'neutral' {
    const avg = this.getAverageEngagement()
    if (avg > HIGH_ENGAGEMENT) return 'deep'
    if (avg < 0.3) return 'broad'
    return 'neutral'
  }

  // ---- Recommendations ----

  /**
   * Pick the best branch for auto-continue (infinite scroll).
   * Claude ranks branches by quality; we weight by engagement when we have data.
   */
  getBestAutoBranch(branches: string[]): string | null {
    if (branches.length === 0) return null

    const tops = this.getTopEngagedTopics(5)
    if (tops.length === 0) return branches[0]

    const toWords = (s: string) =>
      s.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const topWords = new Set(tops.flatMap(toWords))

    let best = branches[0]!
    let bestScore = -1

    for (const b of branches) {
      const words = toWords(b)
      if (words.length === 0) continue
      const overlap = words.filter((w) => topWords.has(w)).length / words.length
      if (overlap > bestScore) {
        bestScore = overlap
        best = b
      }
    }

    return best
  }

  /**
   * Build a context string summarizing user engagement.
   * Passed to Claude to bias branch selection toward what the reader cares about.
   */
  getEngagementContext(): string {
    if (this.scores.size === 0) return ''

    const tops = this.getTopEngagedTopics(3)
    const pref = this.getUserPreference()
    let ctx = ''

    if (tops.length > 0) {
      ctx += `Reader was most engaged with: ${tops.join(', ')}. `
    }
    if (pref === 'deep') {
      ctx += 'They prefer in-depth exploration. Choose branches that go deeper into related concepts.'
    } else if (pref === 'broad') {
      ctx += 'They prefer breadth and variety. Choose branches covering different angles and broader topics.'
    }

    return ctx
  }

  // ---- Persistence ----

  /** Serialize to JSON for localStorage / database */
  toJSON(): string {
    return JSON.stringify({
      interactions: Array.from(this.interactions.entries()),
      scores: Array.from(this.scores.entries()),
    })
  }

  /** Restore from serialized JSON */
  static fromJSON(json: string): EngagementTracker {
    const t = new EngagementTracker()
    try {
      const d = JSON.parse(json)
      t.interactions = new Map(d.interactions)
      t.scores = new Map(d.scores)
    } catch { /* return fresh tracker */ }
    return t
  }
}
