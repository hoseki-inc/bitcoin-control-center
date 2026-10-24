import { inspect } from 'node:util'
import { hideWalletDetailsInError, hideWalletDetailsInText, hidesWalletDetails } from './log_redaction'
import { main } from './main'
import { requestNewPin, requestPinReset } from './modules/auth/platform'

// `pnpm dev:desktop` runs Sentinel as the desktop app does: with saved connections,
// and with settings available even while the Electrum server is unreachable.
const desktop = process.argv.includes('--desktop')

// A crash prints to stderr, bypassing the logger, so it hides wallet details and hosts the same
// way. At Debug and Trace, Node prints crashes in full as before.
const hideDetails = hidesWalletDetails(process.env['LOG_LEVEL'] ?? 'info')
const crashed =
  (label: string) =>
  (cause: unknown): void => {
    const shown = !hideDetails
      ? cause
      : cause instanceof Error
        ? hideWalletDetailsInError(cause)
        : hideWalletDetailsInText(inspect(cause))
    console.error(label, shown)
    process.exit(1)
  }

if (hideDetails) {
  process.on('uncaughtException', crashed('Uncaught exception:'))
  process.on('unhandledRejection', crashed('Unhandled rejection:'))
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Platform tools run these beside the server; each takes effect when Sentinel next starts. `reset-pin` clears the
 * PIN so the app asks for a new one. `set-pin` reads the new PIN from stdin, never from arguments, which other
 * processes can see. Only DATA_DIR is read, so they work without the server's Electrum settings.
 */
async function runPinCommand(command: 'reset-pin' | 'set-pin'): Promise<number> {
  const dataDir = process.env['DATA_DIR'] ?? './data'
  if (command === 'reset-pin') {
    requestPinReset(dataDir)
    console.log('The PIN will be cleared when Bitcoin Control Center restarts. Your data is kept.')
    return 0
  }
  const result = await requestNewPin(dataDir, (await readStdin()).trim())
  if (result.isErr()) {
    console.error(result.unwrapErr().message)
    return 1
  }
  console.log('The new PIN applies when Bitcoin Control Center restarts.')
  return 0
}

const command = process.argv[2]
if (command === 'reset-pin' || command === 'set-pin') {
  runPinCommand(command).then((code) => process.exit(code), crashed(`Unhandled error in ${command}:`))
} else {
  main(desktop ? { connectionProfiles: true, waitForElectrum: false, statementSourceSetting: true } : {}).catch(
    crashed('Unhandled error in main:'),
  )
}
