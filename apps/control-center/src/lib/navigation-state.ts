import { parseUnknown } from '@hoseki/packages/result'
import { z } from 'zod'

const NavigationStateSchema = z.object({
  returnTo: z.string().optional(),
  displayName: z.string().optional(),
  replaceAccountId: z.string().optional(),
  preSelectedClaimIds: z.array(z.string()).optional(),
})

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Router state is untrusted runtime input and must be parsed here.
export function parseNavigationState(value: unknown): z.infer<typeof NavigationStateSchema> | null {
  return parseUnknown(NavigationStateSchema, value).unwrapOr(null)
}
