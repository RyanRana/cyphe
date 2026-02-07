/**
 * CYPHE — Simple in-memory cache with TTL
 *
 * Used for Wikipedia and Claude responses to avoid repeated calls.
 * Server-side only; clears on restart.
 */

const CACHE = new Map<string, { value: unknown; expires: number }>()

const TTL = {
  wikipedia: 60 * 60 * 1000, // 1 hour
  claude: 60 * 60 * 1000, // 1 hour
}

function key(prefix: string, id: string): string {
  return `${prefix}:${id.toLowerCase().trim()}`
}

export function get<T>(prefix: string, id: string): T | null {
  const entry = CACHE.get(key(prefix, id))
  if (!entry || Date.now() > entry.expires) return null
  return entry.value as T
}

export function set(prefix: string, id: string, value: unknown, ttlMs = TTL.wikipedia): void {
  CACHE.set(key(prefix, id), { value, expires: Date.now() + ttlMs })
}

export function getExploreCache<T>(topic: string): T | null {
  return get<T>('explore', topic)
}

export function setExploreCache(topic: string, value: unknown): void {
  set('explore', topic, value, TTL.wikipedia)
}

export function getExpandCache<T>(topic: string): T | null {
  return get<T>('expand', topic)
}

export function setExpandCache(topic: string, value: unknown): void {
  set('expand', topic, value, TTL.wikipedia)
}

export function getWikipediaNode<T>(topic: string): T | null {
  return get<T>('wiki:node', topic)
}

export function setWikipediaNode(topic: string, value: unknown): void {
  set('wiki:node', topic, value, TTL.wikipedia)
}

export function getClaudeBranchSelection<T>(topic: string): T | null {
  return get<T>('claude:branches', topic)
}

export function setClaudeBranchSelection(topic: string, value: unknown): void {
  set('claude:branches', topic, value, TTL.claude)
}

export function getClaudeTransition<T>(from: string, to: string): T | null {
  return get<T>('claude:transition', `${from}|||${to}`)
}

export function setClaudeTransition(from: string, to: string, value: unknown): void {
  set('claude:transition', `${from}|||${to}`, value, TTL.claude)
}
