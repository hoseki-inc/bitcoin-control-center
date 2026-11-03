import { expect, it, onTestFinished, vi } from 'vitest'
import { dollarsToCents, formatInvestmentValue, formatValuationDate } from './value'

it('converts dollar inputs to exact cents without floating point rounding', () => {
  expect(dollarsToCents('0')).toBe('0')
  expect(dollarsToCents('12500.10')).toBe('1250010')
  expect(dollarsToCents('0.29')).toBe('29')
  expect(dollarsToCents('90071992547409.91')).toBe('9007199254740991')
  for (const value of ['', '-1', '1.001', 'NaN', 'Infinity', '1e6', '90071992547409.92']) {
    expect(dollarsToCents(value)).toBeNull()
  }
})

it('displays the recorded dollar value', () => {
  expect(formatInvestmentValue('1350050')).toBe('$13,500.50')
})

it.each([
  { locale: 'en-US', zone: 'Pacific/Kiritimati', date: '2026-11-03', expected: 'Nov 3, 2026' },
  { locale: 'en-GB', zone: 'Pacific/Kiritimati', date: '2026-12-31', expected: '31 Dec 2026' },
  { locale: 'en-US', zone: 'America/Los_Angeles', date: '2024-02-29', expected: 'Feb 29, 2024' },
])(
  'preserves the complete recorded date in $locale with browser timezone $zone',
  ({ locale, zone, date, expected }) => {
    // Simulate the browser's defaults, using real Intl formatting and honoring any explicit timezone.
    const formatter = vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      locales,
      options,
    ) {
      return new Intl.DateTimeFormat(locales ?? locale, { timeZone: zone, ...options }).format(this)
    })
    onTestFinished(() => {
      formatter.mockRestore()
    })
    expect(formatValuationDate(date)).toBe(expected)
  },
)
