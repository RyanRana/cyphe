export default function NextNodes({ nodes, onNavigate }) {
  if (!nodes || nodes.length === 0) return null

  return (
    <div className="mt-12 mb-6">
      {/* Section divider */}
      <div className="flex items-center gap-3 mb-5">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500/60">
            <circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
          </svg>
          Explore next
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {nodes.map((node) => (
          <button
            key={node.id}
            onClick={() => onNavigate(node.id, node.label)}
            className="text-left rounded-xl bg-gray-900/40 border border-gray-800/50 hover:border-blue-500/40 hover:bg-blue-500/[0.03] transition-all duration-200 p-4 card-hover group"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-blue-500/20 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </div>
              <div className="min-w-0">
                <span className="text-blue-400 font-medium text-sm group-hover:text-blue-300 transition-colors">{node.label}</span>
                {node.description && (
                  <p className="text-gray-500 text-xs mt-1 leading-relaxed line-clamp-2">{node.description}</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
