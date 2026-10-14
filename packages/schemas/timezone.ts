import { z } from 'zod'

/**
 * Accepts any zone the runtime can format: aliases such as Asia/Kolkata, fixed offsets such as
 * Etc/GMT+8 or +05:30, and names in any letter case. Browsers report some of these, but
 * Intl.supportedValuesOf omits them.
 */
export function isUsableTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export const TimezoneSchema = z.string().refine(isUsableTimezone, 'Invalid timezone')
export type Timezone = z.infer<typeof TimezoneSchema>
