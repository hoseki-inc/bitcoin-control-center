import { requestNewPin, requestPinReset } from './modules/auth/platform'

export const PIN_COMMANDS = ['reset-pin', 'set-pin'] as const
export type PinCommand = (typeof PIN_COMMANDS)[number]

export function isPinCommand(value: string | undefined): value is PinCommand {
  return PIN_COMMANDS.some((command) => command === value)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Platform tools run these beside the server; each takes effect when Sentinel next starts.
 * `reset-pin` clears the PIN so the app asks for a new one. `set-pin` reads the new PIN from stdin, never
 * from arguments, which other processes can see.
 * Only DATA_DIR is read, so the commands work without the server's Electrum settings.
 */
export async function runPinCommand(command: PinCommand): Promise<number> {
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
