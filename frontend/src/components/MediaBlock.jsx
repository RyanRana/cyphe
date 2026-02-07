import { useState } from 'react'

export default function MediaBlock({ block }) {
  const { type, media } = block
  if (!media) return null

  switch (type) {
    case 'unsplash':
    case 'wikipedia_image':
    case 'wikimedia':
    case 'meme':
      return <ImageMedia media={media} type={type} />
    case 'reddit':
      return <RedditCard media={media} />
    case 'twitter':
      return <TwitterCard media={media} />
    case 'xkcd':
      return <XkcdComic media={media} />
    default:
      return null
  }
}

function ImageMedia({ media, type }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  if (error) return null

  const sourceLabel = {
    unsplash: 'Unsplash',
    wikipedia_image: 'Wikipedia',
    wikimedia: 'Wikimedia',
    meme: 'Meme',
  }[type] || ''

  return (
    <figure className="rounded-xl overflow-hidden bg-gray-900/50 border border-gray-800/50">
      {!loaded && <div className="w-full h-56 shimmer" />}
      <img
        src={media.url}
        alt={media.attribution || ''}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`w-full object-contain max-h-[28rem] ${loaded ? 'block' : 'w-0 h-0 overflow-hidden'}`}
      />
      <div className="px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {media.description && (
            <p className="text-gray-300 text-xs truncate">{media.description}</p>
          )}
          {media.attribution && (
            <p className="text-gray-500 text-[11px] truncate mt-0.5">{media.attribution}</p>
          )}
        </div>
        <span className="text-[10px] text-gray-600 bg-gray-800/60 px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider font-medium">
          {sourceLabel}
        </span>
      </div>
    </figure>
  )
}

function RedditCard({ media }) {
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl bg-gray-900/50 border border-gray-800/50 hover:border-orange-500/30 transition-all duration-200 p-4 card-hover group"
    >
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-5 h-5 rounded-full bg-orange-500/15 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#f97316"><circle cx="12" cy="12" r="10"/></svg>
        </div>
        <span className="text-orange-400 text-xs font-medium">{media.source || 'Reddit'}</span>
        {media.score != null && (
          <span className="text-gray-500 text-[11px] ml-auto flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
            {media.score}
          </span>
        )}
      </div>
      {media.title && <p className="text-gray-200 text-sm leading-snug group-hover:text-white transition-colors">{media.title}</p>}
      <p className="text-gray-600 text-[11px] mt-2">{media.attribution}</p>
    </a>
  )
}

function TwitterCard({ media }) {
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl bg-gray-900/50 border border-gray-800/50 hover:border-blue-500/30 transition-all duration-200 p-4 card-hover group"
    >
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-5 h-5 rounded-full bg-blue-500/15 flex items-center justify-center">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="#60a5fa"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </div>
        <span className="text-blue-400 text-xs font-medium truncate">{media.attribution || 'Twitter/X'}</span>
      </div>
      {media.text && <p className="text-gray-200 text-sm leading-relaxed mb-3 group-hover:text-white transition-colors">{media.text}</p>}
      <div className="flex gap-4 text-[11px] text-gray-500">
        {media.likes != null && (
          <span className="flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            {media.likes.toLocaleString()}
          </span>
        )}
        {media.retweets != null && (
          <span className="flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            {media.retweets.toLocaleString()}
          </span>
        )}
      </div>
    </a>
  )
}

function XkcdComic({ media }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  if (error) return null

  return (
    <figure className="rounded-xl overflow-hidden bg-gray-900/50 border border-gray-800/50">
      {media.title && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2">
          <span className="text-[10px] text-gray-500 bg-gray-800/60 px-2 py-0.5 rounded-full uppercase tracking-wider font-medium">xkcd</span>
          <span className="text-sm font-medium text-gray-300">{media.title}</span>
        </div>
      )}
      {!loaded && <div className="w-full h-56 shimmer" />}
      <img
        src={media.url}
        alt={media.alt_text || media.title || ''}
        title={media.alt_text || ''}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`w-full object-contain max-h-[28rem] bg-white/95 ${loaded ? 'block' : 'w-0 h-0 overflow-hidden'}`}
      />
      <div className="px-4 py-2.5">
        {media.alt_text && <p className="text-gray-500 text-[11px] italic">{media.alt_text}</p>}
        <p className="text-gray-600 text-[11px] mt-0.5">{media.attribution}</p>
      </div>
    </figure>
  )
}
