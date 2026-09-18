import { afterEach, expect, it, vi } from 'vitest'
import { shutdownWithDeadline } from '../src/shutdown'

afterEach(() => vi.useRealTimers())

it('allows a slow shutdown to finish gracefully before the deadline', async () => {
  vi.useFakeTimers()
  const exit = vi.fn()
  const cleanup = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 9000)))
  const shutdown = shutdownWithDeadline(cleanup, exit)
  await vi.advanceTimersByTimeAsync(9000)
  await shutdown
  await vi.advanceTimersByTimeAsync(10_000)
  expect(cleanup).toHaveBeenCalledOnce()
  expect(exit).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('exits after ten seconds when a request prevents cleanup from completing', async () => {
  vi.useFakeTimers()
  const exit = vi.fn()
  let finish!: () => void
  const shutdown = shutdownWithDeadline(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    exit,
  )
  await vi.advanceTimersByTimeAsync(9999)
  expect(exit).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(exit).toHaveBeenCalledOnce()
  finish()
  await shutdown
})

it('clears the deadline if cleanup fails so the app can report the failure and retry', async () => {
  vi.useFakeTimers()
  const exit = vi.fn()
  await expect(
    shutdownWithDeadline(async () => {
      throw new Error('Cleanup failed')
    }, exit),
  ).rejects.toThrow('Cleanup failed')
  await vi.advanceTimersByTimeAsync(10_000)
  expect(exit).not.toHaveBeenCalled()
})
