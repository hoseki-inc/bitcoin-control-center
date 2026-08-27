// TODO: It would be good to extend these to proper Zod schemas instead of hacky reexports
import { z } from 'zod'
import { BTC, Money } from '../currency'

export function money(): z.ZodType<Money> {
  return z.custom<Money>((v) => v instanceof Money, {
    message: 'Invalid money object',
  })
}

money.nonnegative = money().refine((v) => v.gte(0), {
  message: 'Amount must be greater than or equal to 0',
})

export function btc(): z.ZodType<BTC> {
  return z.custom<BTC>((v) => v instanceof BTC || (v instanceof Money && v.currency.code == 'BTC'), {
    message: 'Invalid BTC object',
  })
}

money.btc = btc

btc.nonnegative = btc().refine((v) => v.gte(0), {
  message: 'BTC amount must be greater than or equal to 0',
})

export const moneyDto = z.object({
  code: z.string(),
  minor: z.string(),
  major: z.string(),
  usdRate: z.string().optional(),
  usdValue: z.string().optional(),
})
export type MoneyDto = z.infer<typeof moneyDto>
