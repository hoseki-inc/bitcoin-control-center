import { format } from 'date-fns'

/** Today's date in the browser's time zone, as a date input value. */
export function todayLocalDate(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/** Noon on a date input's day in the browser's time zone, never later than now. */
export function localDateToIso(date: string): string {
  const noon = new Date(`${date}T12:00:00`)
  return new Date(Math.min(noon.getTime(), Date.now())).toISOString()
}
