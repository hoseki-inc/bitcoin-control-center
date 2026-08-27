import { z } from 'zod'

export const GetCandlesArgsSchema = z.object({
  productId: z.enum(['btc-usd']),
  /**
   * In seconds as string
   */
  granularity: z.string(),
  /**
   * ISO 8601
   */
  start: z.string().optional(),
  /**
   * ISO 8601
   */
  end: z.string().optional(),
})

export type GetCandlesArgs = z.infer<typeof GetCandlesArgsSchema>

export const GetCandlesResponseSchema = z.array(
  z.tuple([
    /**
     * Time bucket start time, as Unix timestamp
     */
    z.number(),
    /**
     * Lowest price during the bucket interval
     */
    z.number(),
    /**
     * Highest price during the bucket interval
     */
    z.number(),
    /**
     * Opening price (first trade) in the bucket interval
     */
    z.number(),
    /**
     * Closing price (last trade) in the bucket interval
     */
    z.number(),
    /**
     * Volume of trading activity during the bucket interval
     */
    z.number(),
  ]),
)

export type GetCandlesResponse = z.infer<typeof GetCandlesResponseSchema>

export const ExchangeErrorSchema = z.object({
  message: z.string(),
})

export type ExchangeError = z.infer<typeof ExchangeErrorSchema>

export interface GetProductStatsArgs {
  productId: string
}

export const GetProductStatsResponseSchema = z.object({
  data: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    volume: z.number(),
    last: z.number(),
    volume_30day: z.string(),
  }),
})

export type GetProductStatsResponse = z.infer<typeof GetProductStatsResponseSchema>
