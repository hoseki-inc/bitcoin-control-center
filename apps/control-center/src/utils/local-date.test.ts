import { expect, it, onTestFinished, vi } from 'vitest'
import { localDateToIso, todayLocalDate } from './local-date'

// vite.config.ts runs tests in America/New_York.
function setNow(iso: string): void {
  onTestFinished(() => {
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

it('uses the local day, not the UTC one', () => {
  setNow('2026-10-29T03:30:00.000Z') // 11:30 pm on October 28 in New York
  expect(todayLocalDate()).toBe('2026-10-28')
  expect(localDateToIso('2026-10-01')).toBe('2026-10-01T16:00:00.000Z')
})

it('never returns a time after now for today', () => {
  setNow('2026-10-28T12:15:00.000Z') // 8:15 am in New York
  expect(localDateToIso('2026-10-28')).toBe('2026-10-28T12:15:00.000Z')
})
