import { describe, expect, it, vi } from 'vitest'
import { type RunProgram, confirmComputerAdmin } from '../src/computer-admin'

function runner(succeeds: boolean) {
  return vi.fn<RunProgram>().mockResolvedValue(succeeds)
}

describe('confirmComputerAdmin', () => {
  it('uses the administrator prompt on macOS', async () => {
    const run = runner(true)
    await expect(confirmComputerAdmin('darwin', run)).resolves.toBe(true)
    const [file, args] = run.mock.calls[0] ?? []
    expect(file).toBe('/usr/bin/osascript')
    expect(args?.join(' ')).toContain('with administrator privileges')
  })

  it('uses User Account Control on Windows', async () => {
    const run = runner(true)
    await expect(confirmComputerAdmin('win32', run)).resolves.toBe(true)
    expect(run.mock.calls[0]?.[0]).toMatch(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/)
    expect(run.mock.calls[0]?.[1].join(' ')).toContain('-Verb RunAs')
  })

  it('uses polkit on Linux', async () => {
    const run = runner(true)
    await expect(confirmComputerAdmin('linux', run)).resolves.toBe(true)
    expect(run.mock.calls[0]).toEqual(['pkexec', ['/bin/true']])
  })

  it('reports a cancelled or refused prompt', async () => {
    await expect(confirmComputerAdmin('darwin', runner(false))).resolves.toBe(false)
  })

  it('refuses on a system without a prompt', async () => {
    const run = runner(true)
    await expect(confirmComputerAdmin('freebsd', run)).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
