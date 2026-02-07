import MediaBlock from './MediaBlock'

export default function ContentGroup({ blocks }) {
  const textBlock = blocks.find((b) => b.type === 'text')
  const mediaBlock = blocks.find((b) => b.type !== 'text')

  return (
    <div className="mb-6">
      {textBlock && <TextBlock block={textBlock} />}
      {mediaBlock && (
        <div className="mt-3">
          <MediaBlock block={mediaBlock} />
        </div>
      )}
    </div>
  )
}

function TextBlock({ block }) {
  const { group_role, content } = block

  switch (group_role) {
    case 'funfact':
      return (
        <div className="relative pl-5 py-3 border-l-2 border-amber-500/60 bg-amber-500/[0.03] rounded-r-lg">
          <span className="absolute left-3 top-3 text-amber-500/40 text-xs font-medium uppercase tracking-wider">Fun fact</span>
          <p className="text-amber-100/90 leading-relaxed mt-4 text-[15px]">{content}</p>
        </div>
      )
    case 'caption':
      return <p className="text-gray-400 text-sm italic leading-relaxed">{content}</p>
    case 'context':
      return (
        <p className="text-gray-400 text-sm leading-relaxed pl-4 border-l border-gray-800">{content}</p>
      )
    default: // explanation
      return <p className="text-gray-200 text-[15px] leading-[1.75] tracking-[-0.01em]">{content}</p>
  }
}
