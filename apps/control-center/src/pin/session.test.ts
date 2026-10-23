import { describe, expect, it } from 'vitest'
import { continuesTab } from './session'

const startedAt = 1_700_000_000_000

describe('continuesTab', () => {
  it('keeps the tab through a reload, however long the page takes to load', () => {
    // The old page leaves once the server answers: at once, or many seconds into a slow load.
    expect(continuesTab('reload', startedAt + 50, startedAt)).toBe(true)
    expect(continuesTab('reload', startedAt + 11_000, startedAt)).toBe(true)
    // Clock jitter can put the leave a moment before the start.
    expect(continuesTab('reload', startedAt - 300, startedAt)).toBe(true)
  })

  it('asks again for a closed tab that is reopened, even quickly or through a reload', () => {
    expect(continuesTab('reload', startedAt - 2000, startedAt)).toBe(false)
    expect(continuesTab('reload', startedAt - 60_000, startedAt)).toBe(false)
    expect(continuesTab('back_forward', startedAt + 50, startedAt)).toBe(false)
  })

  it('asks again for a duplicated or newly opened tab', () => {
    expect(continuesTab('navigate', null, startedAt)).toBe(false)
    expect(continuesTab('reload', null, startedAt)).toBe(false)
    expect(continuesTab(null, null, startedAt)).toBe(false)
  })

  it('goes by timing alone where the browser hides the navigation, as Tor Browser does', () => {
    expect(continuesTab(null, startedAt + 50, startedAt)).toBe(true)
    expect(continuesTab(null, startedAt - 60_000, startedAt)).toBe(false)
  })

  it('ignores a leave time far in the future', () => {
    expect(continuesTab('reload', startedAt + 60 * 60 * 1000, startedAt)).toBe(false)
  })
})
