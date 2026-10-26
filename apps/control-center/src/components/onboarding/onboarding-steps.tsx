import {
  AccountTypesPreview,
  BalancePreview,
  ConnectionsPreview,
  HomePreview,
  PermissionsPreview,
} from './onboarding-previews'

export interface OnboardingStep {
  id: string
  title: string
  body: string
  preview: JSX.Element
  /** Controls under the text, for a step that asks something. `next` does what the primary button does. */
  controls?: (next: () => void) => JSX.Element
  /** Takes the place of Continue, for a step that has to finish something before the next one. */
  primary?: StepAction
  /** Carries on from the step before it, so the two share a dot. */
  followUp?: boolean
}

export interface StepAction {
  label: string
  isLoading?: boolean
  /** The button's label while `run` works. */
  loadingText?: string
  /** Resolves true to go on to the next step. */
  run: () => Promise<boolean>
}

/**
 * The introduction's steps. Where data comes from differs between the desktop app and a server
 * install. `serverSteps` are desktop's choice of Electrum server, just before the first account.
 */
export function onboardingSteps(desktop: boolean, serverSteps: OnboardingStep[] = []): OnboardingStep[] {
  return [
    {
      id: 'welcome',
      title: 'Your Bitcoin, in one place',
      body: 'See your wallets and exchanges together, and how your holdings change over time.',
      preview: <BalancePreview />,
    },
    {
      id: 'connect',
      title: 'Bring in what you already use',
      body: 'Connect a hardware wallet, multisig, exchange, or even enter holdings yourself. You can also generate a statement of your self-custodial holdings over any period.',
      preview: <AccountTypesPreview />,
    },
    {
      id: 'watch-only',
      title: 'It can see, not spend',
      body: 'Wallets connect watch-only, and exchanges only need a read-only key. Control Center never asks for your seed phrase and can’t move your Bitcoin.',
      preview: <PermissionsPreview />,
    },
    {
      id: 'privacy',
      title: 'Your data stays with you',
      body: desktop
        ? 'Your history is saved on this computer. Balances come from an Electrum server you choose and any exchanges you expressly connect. No Hoseki account needed.'
        : 'Your history is saved on your server. Balances come from your node’s Electrum server and any exchanges you expressly connect. No Hoseki account needed.',
      preview: <ConnectionsPreview />,
    },
    ...serverSteps,
    {
      id: 'get-ready',
      title: 'Start with one account',
      body: 'Have one of these ready: your hardware wallet, a read-only API key from your exchange, or just your balance to enter by hand.',
      preview: <HomePreview />,
    },
  ]
}
