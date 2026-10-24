import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

// Records that the Set PIN action ran. Sentinel keeps the PIN itself, hashed, in its own database.
export const pinSchema = z.looseObject({ pinSetAt: z.number().nullable().default(null) })

export const pinFile = FileHelper.json({ base: sdk.volumes.main, subpath: 'start9/pin.json' }, pinSchema)
