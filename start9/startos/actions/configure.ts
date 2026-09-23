import { configFile } from '../fileModels/configFile'
import { sdk } from '../sdk'

const inputSpec = sdk.InputSpec.of({
  'log-level': sdk.Value.select({
    name: 'Log Level',
    default: 'info',
    values: {
      error: 'Error',
      warn: 'Warning',
      info: 'Info',
      debug: 'Debug',
      trace: 'Trace',
    },
  }),
})

export const configure = sdk.Action.withInput(
  'configure',
  {
    name: 'Configure',
    description: 'Configure Bitcoin Control Center logging.',
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  },
  inputSpec,
  async ({ effects }) => {
    return configFile.read().const(effects)
  },
  async ({ effects, input }) => {
    await configFile.write(effects, input)
    return null
  },
)
