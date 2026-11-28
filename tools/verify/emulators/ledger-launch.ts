import { Err, type Result } from '@hoseki/packages/result'
import {
  type EmulatorSeedName,
  type EmulatorState,
  type LedgerModel,
  type RunPaths,
  captureDockerDaemon,
  ledgerElfCacheDir,
} from '../run'
import { type BridgeRequest, type LedgerStart, release, reserve, startLedgerEmulator } from './ledger'
import { dockerArch, ensureLedgerElf } from './ledger-elf'

// The whole Ledger start that `emulator start` and `launch --emulator ledger` share.
export interface LedgerLaunch {
  model: LedgerModel
  seed: EmulatorSeedName
  bridge?: BridgeRequest
  log?: (line: string) => void
}

/**
 * Everything `emulator start` and `launch --emulator ledger` do: reserve the start before any Docker or ELF work, so a
 * duplicate is refused at once, then find the daemon, build or reuse the pinned ELF and start the device.
 */
export async function startLedger(paths: RunPaths, launch: LedgerLaunch): Promise<Result<EmulatorState, string>> {
  const log = launch.log ?? console.log
  const refused = await reserve(paths)
  if (refused !== null) {
    return Err(refused)
  }
  try {
    const daemon = captureDockerDaemon()
    if (daemon.isErr()) {
      return Err(daemon.unwrapErr())
    }
    const arch = dockerArch(daemon.unwrap())
    if (arch.isErr()) {
      return Err(arch.unwrapErr())
    }
    const start = { model: launch.model, seed: launch.seed, arch: arch.unwrap(), daemon: daemon.unwrap() }
    const elf = await ensureLedgerElf(paths, { ...start, cacheDir: ledgerElfCacheDir() })
    if (elf.isErr()) {
      return Err(elf.unwrapErr())
    }
    log(`Starting Speculos (${launch.model}, seed ${launch.seed}) on linux/${start.arch}`)
    const ledgerStart: LedgerStart = { ...start, elfPath: elf.unwrap() }
    if (launch.bridge !== undefined) {
      ledgerStart.bridge = launch.bridge
    }
    return await startLedgerEmulator(paths, ledgerStart)
  } catch (error) {
    return Err(error instanceof Error ? error.message : String(error))
  } finally {
    await release(paths)
  }
}
