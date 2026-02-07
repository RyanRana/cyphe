/**
 * Example usage of getWikipediaNode
 *
 * Run with: npx tsx src/lib/wikipedia.example.ts
 * Or import and call from your app.
 */

import { getWikipediaNode } from './wikipedia'

async function main() {
  const topic = process.argv[2] || 'Quantum entanglement'
  console.log(`Fetching Wikipedia node for "${topic}"...\n`)

  const node = await getWikipediaNode(topic)

  if (node.error) {
    console.error('Error:', node.error)
    return
  }

  console.log('=== Wikipedia Node ===')
  console.log('Title:', node.title)
  console.log('URL:', node.pageUrl)
  console.log('\n--- Summary (first ~1200 chars) ---')
  console.log(node.summary.substring(0, 500) + '...')
  console.log('\n--- Branches (3-5 next topics) ---')
  console.log(node.branches)
  console.log('\n--- Raw links count ---')
  console.log(node.rawLinks?.length ?? 0)
}

main()
