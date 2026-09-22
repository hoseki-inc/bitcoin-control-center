import { parseUnknown } from '@hoseki/packages/result'
import { z } from 'zod'

const NavigationStateSchema = z.object({
  returnTo: z.string().optional(),
  displayName: z.string().optional(),
  replaceAccountId: z.string().optional(),
  preSelectedClaimIds: z.array(z.string()).optional(),
})

export function parseNavigationState(value: unknown): z.infer<typeof NavigationStateSchema> | null {
  return parseUnknown(NavigationStateSchema, value).unwrapOr(null)
}
