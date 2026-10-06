import { configFile } from '../fileModels/configFile'
import { sdk } from '../sdk'

const inputSpec = sdk.InputSpec.of({
  'mempool-url': sdk.Value.text({
    name: 'Mempool URL Override',
    description:
      'Leave blank to use the installed mempool service, or public mempool.space when it is not installed. Enter an HTTP(S) URL to use another instance. Statements need it to be running; missing prices use public mempool.space only while "Allow fallbacks" is on in Settings.',
    required: false,
    default: null,
    patterns: [
      {
        regex: '^https?://[^\\s@?#]+$',
        description: 'Enter an HTTP or HTTPS URL without credentials, a query or a fragment.',
      },
    ],
  }),
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
    description: 'Configure the mempool source and application logging.',
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
