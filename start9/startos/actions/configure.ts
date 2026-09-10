import { configFile } from '../fileModels/configFile'
import { sdk } from '../sdk'

const inputSpec = sdk.InputSpec.of({
  'mempool-url': sdk.Value.text({
    name: 'Mempool URL Override',
    description:
      'Leave blank to use the installed mempool service automatically, or public mempool.space when it is absent. Enter an HTTP(S) URL to override this. Missing historical quotes fall back to public mempool.space. Restart Control Center after changing this setting.',
    required: false,
    default: null,
    patterns: [{ regex: '^https?://[^\\s]+$', description: 'Enter an HTTP or HTTPS URL.' }],
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
