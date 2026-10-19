import { z } from 'zod'

/**
 * Accepts any zone name the runtime can format: aliases such as Asia/Kolkata, Etc/GMT+8, and names
 * in any letter case. Browsers report some of these, but Intl.supportedValuesOf omits them.
 * Rejects numeric offsets such as -00:30, which @date-fns/tz reads with the wrong sign.
 */
export function isUsableTimezone(timezone: string): boolean {
  if (/^[+-]/.test(timezone)) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export const TimezoneSchema = z.string().refine(isUsableTimezone, 'Invalid timezone')
export type Timezone = z.infer<typeof TimezoneSchema>
