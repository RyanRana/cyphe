/**
 * Example: Exploration graph JSON output
 *
 * Run: npx tsx src/lib/graph.example.ts [topic]
 * Loads .env for ANTHROPIC_API_KEY (LLM branch selection)
 */

import 'dotenv/config'
import { buildExplorationGraph } from './graph'

async function main() {
  const topic = process.argv[2] || 'Quantum entanglement'
  console.log(`Building graph for "${topic}"...\n`)

  const graph = await buildExplorationGraph(topic)
  console.log(JSON.stringify(graph, null, 2))
}

main()
