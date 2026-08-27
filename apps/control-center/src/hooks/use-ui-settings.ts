import { useUiSettings as baseUseUiSettings } from '@hoseki/packages/ui/prove-verify-ui/hooks/use-ui-settings'

export function useUiSettings(): ReturnType<typeof baseUseUiSettings<{ isStatementsMadeEasyDismissed: boolean }>> {
  return baseUseUiSettings<{ isStatementsMadeEasyDismissed: boolean }>({
    userId: 'local',
    defaultSettings: {
      isStatementsMadeEasyDismissed: false,
    },
  })
}
