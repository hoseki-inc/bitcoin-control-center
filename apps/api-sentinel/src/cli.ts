import { cliOptions } from './cli-options'
import { reportCrashes } from './crash_logging'
import { main } from './main'
import { isPinCommand, runPinCommand } from './modules/auth/platform'

const crashed = reportCrashes(process.env['LOG_LEVEL'] ?? 'info')

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Platform tools run the PIN commands beside the server. They read only DATA_DIR, so they work without the server's
// Electrum settings.
const command = process.argv[2]
if (isPinCommand(command)) {
  runPinCommand(command, process.env['DATA_DIR'] ?? './data', readStdin).then((result) => {
    if (result.isOk()) {
      console.log(result.unwrap())
    } else {
      console.error(result.unwrapErr())
      process.exitCode = 1
    }
  }, crashed)
} else {
  main(cliOptions(process.argv)).catch(crashed)
}
