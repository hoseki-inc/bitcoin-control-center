import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { OnboardingTakeover } from './onboarding-takeover'

export const ONBOARDING_KEY = 'onboarding_v1'

type OnboardingChoice = 'started' | 'dismissed'

// Survives leaving Home, so a failed save doesn't bring the introduction back until the next launch.
let closedThisSession = false

/**
 * Shows the introduction once on a new installation: every account list loaded with no accounts,
 * and no earlier choice saved. A failed account or setting request never counts as new.
 */
export function FirstRunOnboarding({ accountCount }: { accountCount: number | null }): JSX.Element {
  const navigate = useNavigate()
  const setting = useLocalSetting(ONBOARDING_KEY)
  const [closed, setClosed] = useState(closedThisSession)
  const isOpen = accountCount === 0 && !setting.isLoading && !setting.isError && setting.data === null && !closed

  const close = (choice: OnboardingChoice): void => {
    closedThisSession = true
    setClosed(true)
    setting.saveAsync(choice).catch(() => {
      toast.error("Couldn't save that", { description: 'The introduction may show again next time.' })
    })
  }

  return (
    <OnboardingTakeover
      isOpen={isOpen}
      onSkip={() => {
        close('dismissed')
      }}
      onAddAccount={() => {
        close('started')
        void navigate('/accounts/add')
      }}
    />
  )
}
