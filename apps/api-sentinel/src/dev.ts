import { Ok, parseUnknown } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { z } from 'zod'
import { cliOptions } from './cli-options'
import type { ElectrumLatency } from './context'
import { reportCrashes } from './crash_logging'
import { main } from './main'

// The development entry point. Builds bundle only cli.ts and main.ts, so nothing here ships.

const crashed = reportCrashes(process.env['LOG_LEVEL'] ?? 'info')

const ElectrumLatencySchema = z
  .string()
  .transform((value) => value.split(',').map((part) => Number(part.trim())))
  .pipe(z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0).max(1)]))
  .transform(([requestMs, jitterMs, connectMs, failureRate]): ElectrumLatency => ({
    requestMs,
    jitterMs,
    connectMs,
    failureRate,
  }))

/** `SENTINEL_DEV_ELECTRUM_LATENCY=requestMs,jitterMs,connectMs,failureRate`, such as `800,400,8000,0.02`. */
function readElectrumLatency(value: string | undefined): Result<ElectrumLatency | undefined, Error> {
  if (value === undefined || value.trim() === '') {
    return Ok(undefined)
  }
  return parseUnknown(ElectrumLatencySchema, value)
}

const latency = readElectrumLatency(process.env['SENTINEL_DEV_ELECTRUM_LATENCY'])
if (latency.isErr()) {
  console.error(
    'SENTINEL_DEV_ELECTRUM_LATENCY must be requestMs,jitterMs,connectMs,failureRate, such as 800,400,8000,0.02',
  )
  process.exit(1)
}
const electrumLatency = latency.unwrap()
if (electrumLatency !== undefined) {
  console.warn('Simulating slow Electrum for development:', electrumLatency)
}

main({ ...cliOptions(process.argv), electrumLatency }).catch(crashed)
