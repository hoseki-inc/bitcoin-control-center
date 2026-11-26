import { readArgs } from './args'
import { type CleanupSummary, cleanupRunResources, fail, runPaths, selectRunId } from './run'

// Stops the processes and Docker containers this run started, keeps its logs as evidence, and removes its scratch
// folder. Never kills by name or port: only the process groups and container IDs recorded for this run.
// Usage: helpers/verify cleanup [--run <id>]

const paths = runPaths(selectRunId(readArgs({ run: { type: 'string' } }).values.run))
let summary: CleanupSummary
try {
  summary = await cleanupRunResources(paths)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
if (!summary.ok) {
  for (const error of summary.errors) {
    console.error(error)
  }
  process.exit(1)
}
