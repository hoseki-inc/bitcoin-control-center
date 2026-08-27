import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

export const configFile = FileHelper.yaml(
  { base: sdk.volumes.main, subpath: 'start9/config.yaml' },
  z.object({
    'log-level': z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
)
