import { useState } from 'react'

export default function SearchBar({ onSearch, loading, compact = false }) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (trimmed && !loading) {
      onSearch(trimmed)
      setQuery('')
    }
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="flex-1 flex gap-2 min-w-0">
        <div className={`flex-1 relative transition-all duration-200 ${focused ? 'glow-blue' : ''} rounded-lg`}>
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search a topic..."
            className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-medium rounded-lg transition-all duration-200 shrink-0"
        >
          {loading ? <Spinner size={12} /> : 'Go'}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className={`flex gap-3 transition-all duration-300 ${focused ? 'glow-blue-lg' : ''} rounded-2xl`}>
        <div className="relative flex-1">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="e.g. Black Holes, CRISPR, Quantum Computing..."
            autoFocus
            className="w-full bg-gray-800/60 border border-gray-700/50 rounded-2xl pl-11 pr-5 py-3.5 text-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/40 transition-all duration-200"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-7 py-3.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-medium rounded-2xl transition-all duration-200 shrink-0 flex items-center gap-2"
        >
          {loading ? (
            <>
              <Spinner size={18} />
              <span>Loading...</span>
            </>
          ) : (
            'Explore'
          )}
        </button>
      </div>
    </form>
  )
}

function Spinner({ size = 16 }) {
  return (
    <span
      className="inline-block border-2 border-white/20 border-t-white rounded-full animate-spin"
      style={{ width: size, height: size }}
    />
  )
}
