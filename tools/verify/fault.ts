import { readArgs } from './args'
import { activeFaults, withFault } from './rules'
import {
  FAULT_MODES,
  FAULT_TARGETS,
  type FaultMode,
  type FaultTarget,
  type Faults,
  HELPER,
  NO_FAULTS,
  fail,
  invalidMessage,
  readAppliedFaults,
  requireJsonFile,
  runPaths,
  selectRunId,
  wait,
  withRunLock,
} from './run'

// Makes a fake fail on purpose, to drive the app's error states, then puts it right. `down` refuses connections,
// `slow` holds every answer for five seconds, `error` fails every request but Electrum's keepalives, `ok` restores it.
// Waits until the fakes confirm the change.
// Usage: helpers/verify fault [--run <id>] electrum|mempool ok|down|slow|error

const APPLY_TIMEOUT_MS = 5_000
const USAGE = `Usage: ${HELPER} fault [--run <id>] ${FAULT_TARGETS.join('|')} ${FAULT_MODES.join('|')}`

const { values, positionals } = readArgs({ run: { type: 'string' } }, 2)
const isTarget = (word: string | undefined): word is FaultTarget => FAULT_TARGETS.some((target) => target === word)
const isMode = (word: string | undefined): word is FaultMode => FAULT_MODES.some((mode) => mode === word)
const [target, mode] = positionals
if (!isTarget(target) || !isMode(mode)) {
  fail(USAGE)
}
const paths = runPaths(selectRunId(values.run))
let next: Faults
try {
  next = await withRunLock(paths, (tracking) => {
    const applied = readAppliedFaults(paths)
    if (applied.status === 'invalid') {
      throw new Error(`${invalidMessage(applied)}. Clean up this run and launch a new one.`)
    }
    const faults = withFault(applied.status === 'ok' ? applied.value : NO_FAULTS, target, mode)
    tracking.writeFaults(faults)
    return faults
  })
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const deadline = Date.now() + APPLY_TIMEOUT_MS
while (requireJsonFile(readAppliedFaults(paths))?.seq !== next.seq) {
  if (Date.now() > deadline) {
    fail(`The fakes did not apply the change. Is the run alive? Check ${HELPER} doctor and ${paths.requestLog}`)
  }
  await wait(100)
}
const active = activeFaults(next)
console.log(active.length === 0 ? 'The fakes behave normally.' : `Faults now: ${active.join(', ')}.`)
