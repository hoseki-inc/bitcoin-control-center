import { z } from 'zod'

// Get supported IANA timezone names from the runtime environment
const supportedTimezones = Intl.supportedValuesOf('timeZone')
export const TimezoneSchema = z.enum(['UTC', ...supportedTimezones])
export type Timezone = z.infer<typeof TimezoneSchema>
