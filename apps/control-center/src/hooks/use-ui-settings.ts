import { isDesktop } from '../mode'
import { useUiPreference } from './use-ui-preference'

export interface UiSettings {
  isStatementsMadeEasyDismissed: boolean
  updateUiSettings: (settings: { isStatementsMadeEasyDismissed?: boolean }) => void
}

export function useUiSettings(desktop = isDesktop): UiSettings {
  const [isStatementsMadeEasyDismissed, save] = useUiPreference('statements_banner_dismissed', desktop)
  return {
    isStatementsMadeEasyDismissed,
    updateUiSettings: (settings) => {
      if (settings.isStatementsMadeEasyDismissed !== undefined) {
        save(settings.isStatementsMadeEasyDismissed)
      }
    },
  }
}
