import { describe, expect, it } from 'vitest'
import { continuesTab } from './session'

const now = 1_700_000_000_000

describe('continuesTab', () => {
  it('keeps the tab through a reload moments after the page left', () => {
    expect(continuesTab('reload', now - 400, now)).toBe(true)
  })

  it('asks again for a closed tab reopened later, even through a reload', () => {
    expect(continuesTab('reload', now - 60_000, now)).toBe(false)
  })

  it('asks again for a reopened, duplicated, or newly opened tab', () => {
    expect(continuesTab('back_forward', now - 400, now)).toBe(false)
    expect(continuesTab('navigate', null, now)).toBe(false)
    expect(continuesTab('reload', null, now)).toBe(false)
    expect(continuesTab(null, now - 400, now)).toBe(false)
  })

  it('asks again when the time it left is in the future', () => {
    expect(continuesTab('reload', now + 1000, now)).toBe(false)
  })
})
