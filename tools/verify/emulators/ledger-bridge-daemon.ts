import { randomBytes } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { readArgs } from '../args'
import { LEDGER_MODELS, bridgeRecordFile, checkId, fail, processGroup, runPaths } from '../run'
import { BRIDGE_MODES, bundleShim, startBridge } from './ledger-bridge'

// The detached Ledger bridge process that `emulator start --bridge` and `launch --emulator ledger` start for a run.
// Once both servers listen it writes ledger-bridge.json (its process group, ports and the control token, mode 0600)
// into the run folder, which the starter waits for. SIGTERM, as from emulator stop or cleanup, tells pages the Ledger is gone and exits.
// Usage: tsx tools/verify/emulators/ledger-bridge-daemon.ts --run <id> --model flex|nanosp --speculos <url>
//          --target <sentinel url> --mode manual|auto

const { values } = readArgs({
  run: { type: 'string' },
  model: { type: 'string' },
  speculos: { type: 'string' },
  target: { type: 'string' },
  mode: { type: 'string' },
})
const model = LEDGER_MODELS.find((candidate) => candidate === values.model) ?? fail('--model flex|nanosp is required')
const mode = BRIDGE_MODES.find((candidate) => candidate === values.mode) ?? fail('--mode manual|auto is required')
const paths = runPaths(checkId('Run', values.run ?? fail('--run is required')))
const loopback = (url: string | undefined): string =>
  url !== undefined && /^http:\/\/127\.0\.0\.1:\d+$/.test(url)
    ? url
    : fail(`expected an http://127.0.0.1:<port> URL, got ${String(url)}`)

const token = randomBytes(32).toString('hex')
const bridge = await startBridge({
  target: loopback(values.target),
  speculosUrl: loopback(values.speculos),
  model,
  mode,
  token,
  shim: await bundleShim(),
  log: (line) => {
    console.log(`${new Date().toISOString()} ${line}`)
  },
})
const file = bridgeRecordFile(paths)
const temp = `${file}.${process.pid}.tmp`
writeFileSync(
  temp,
  // The group's leader is the process the starter recorded (tsx runs this script in a child of it).
  `${JSON.stringify({ pid: processGroup(process.pid) ?? process.pid, drivePort: bridge.drivePort, controlPort: bridge.controlPort, token })}\n`,
  { mode: 0o600 },
)
renameSync(temp, file)
console.log(
  `Ledger bridge for ${model} (${mode}): drive http://127.0.0.1:${bridge.drivePort}, control port ${bridge.controlPort}`,
)

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.once(signal, () => {
    void bridge.close().finally(() => {
      rmSync(file, { force: true })
      process.exit(0)
    })
  })
}
