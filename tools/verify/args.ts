import { type ParseArgsConfig, parseArgs } from 'node:util'

// The only module in tools/verify that reads the command line (lint enforces it). Parsing is strict: an unknown or
// retired flag, a flag without its value and an extra word are all refused, so a mistyped command stops instead of
// acting on the wrong run or recording the wrong thing. Flags may come anywhere; `--run=ID` works too.

type Options = NonNullable<ParseArgsConfig['options']>
type Strict<T extends Options> = { options: T; strict: true; allowPositionals: true }

export function readArgs<T extends Options>(options: T, positionals = 0): ReturnType<typeof parseArgs<Strict<T>>> {
  try {
    const parsed = parseArgs({ args: process.argv.slice(2), options, strict: true, allowPositionals: true })
    if (parsed.positionals.length > positionals) {
      throw new Error(`Unexpected argument: ${parsed.positionals.slice(positionals).join(' ')}`)
    }
    return parsed
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return process.exit(2)
  }
}
