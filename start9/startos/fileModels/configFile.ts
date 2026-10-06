import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

export const configSchema = z.object({
  'mempool-url': z
    .string()
    .url()
    .regex(/^https?:\/\//)
    // fetch refuses credentials, and a query or fragment would break the API paths appended to it.
    .refine((value) => {
      if (!URL.canParse(value)) {
        return false
      }
      const url = new URL(value)
      return url.username === '' && url.password === '' && url.search === '' && url.hash === ''
    }, 'Remove credentials, query and fragment from the mempool URL')
    .nullable()
    .default(null),
  'log-level': z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export const configFile = FileHelper.yaml({ base: sdk.volumes.main, subpath: 'start9/config.yaml' }, configSchema)
