import { useUiPreference } from './use-ui-preference'

export function useUiSettings(): {
  isStatementsMadeEasyDismissed: boolean
  updateUiSettings: (settings: { isStatementsMadeEasyDismissed?: boolean }) => void
} {
  const [isStatementsMadeEasyDismissed, save] = useUiPreference('statements_banner_dismissed')
  return {
    isStatementsMadeEasyDismissed,
    updateUiSettings: (settings) => {
      if (settings.isStatementsMadeEasyDismissed !== undefined) {
        save(settings.isStatementsMadeEasyDismissed)
      }
    },
  }
}
