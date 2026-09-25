import { useUiSettings as baseUseUiSettings } from '@hoseki/packages/ui/prove-verify-ui/hooks/use-ui-settings'
import { z } from 'zod'

const UiSettingsSchema = z.object({ isStatementsMadeEasyDismissed: z.boolean() })

export function useUiSettings(): ReturnType<typeof baseUseUiSettings<{ isStatementsMadeEasyDismissed: boolean }>> {
  return baseUseUiSettings<{ isStatementsMadeEasyDismissed: boolean }>({
    userId: 'local',
    schema: UiSettingsSchema,
    defaultSettings: {
      isStatementsMadeEasyDismissed: false,
    },
  })
}
