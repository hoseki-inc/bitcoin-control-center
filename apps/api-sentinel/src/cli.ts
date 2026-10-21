import { cliOptions } from './cli-options'
import { reportCrashes } from './crash_logging'
import { main } from './main'

const crashed = reportCrashes(process.env['LOG_LEVEL'] ?? 'info')

main(cliOptions(process.argv)).catch(crashed)
