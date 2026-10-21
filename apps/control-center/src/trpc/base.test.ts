import { describe, expect, it } from 'vitest'
import { queryClient, queryRetryDelay, shouldRetryQuery } from './base'

describe('query retries', () => {
  it('retries a failed read twice', () => {
    expect(shouldRetryQuery(0, null)).toBe(true)
    expect(shouldRetryQuery(1, null)).toBe(true)
    expect(shouldRetryQuery(2, null)).toBe(false)
  })

  it('retries server errors but not requests Sentinel refused', () => {
    expect(shouldRetryQuery(0, 500)).toBe(true)
    expect(shouldRetryQuery(0, 404)).toBe(false)
    expect(shouldRetryQuery(0, 400)).toBe(false)
  })

  it('waits a little longer before each retry, never more than 8 seconds', () => {
    expect([0, 1, 2, 3, 4].map(queryRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000])
  })
})

describe('changes', () => {
  it('mark every query stale, without refetching any, so the next page to show one loads it again', async () => {
    const fetches: string[] = []
    await queryClient.fetchQuery({
      queryKey: ['accounts'],
      queryFn: async () => {
        fetches.push('accounts')
        return []
      },
    })
    expect(queryClient.getQueryState(['accounts'])?.isInvalidated).toBe(false)

    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: async () => 'saved' })
      .execute()

    expect(queryClient.getQueryState(['accounts'])?.isInvalidated).toBe(true)
    expect(fetches).toEqual(['accounts'])
    queryClient.clear()
  })
})
