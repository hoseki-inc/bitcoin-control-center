import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readArgs } from './args'
import { EVIDENCE_ROOT, readProcesses, runPaths, selectRunId, stopProcess } from './run'

// Stops the processes this run started, keeps its logs as evidence, and removes its scratch folder.
// Never kills by name or port: only the process groups launch recorded as it started them.
// Usage: helpers/verify cleanup [--run <id>]

const paths = runPaths(selectRunId(readArgs({ run: { type: 'string' } }).values.run))
for (const recorded of readProcesses(paths)) {
  await stopProcess(recorded)
}

if (existsSync(paths.logsDir)) {
  const kept = join(EVIDENCE_ROOT, paths.runId, 'logs')
  cpSync(paths.logsDir, kept, { recursive: true })
  console.log(`Logs kept in ${kept}`)
}
rmSync(paths.runDir, { recursive: true, force: true })
console.log(`Removed ${paths.runDir}`)
