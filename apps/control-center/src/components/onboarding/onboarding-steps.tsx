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
  /** Whether the preview shows made-up amounts, which the pane then labels. */
  sample: boolean
}

/** The introduction's steps. Where data comes from differs between the desktop app and a server install. */
export function onboardingSteps(desktop: boolean): OnboardingStep[] {
  return [
    {
      id: 'welcome',
      title: 'Your Bitcoin, in one place',
      body: 'See your wallets and exchanges together, and how your holdings change over time.',
      preview: <BalancePreview />,
      sample: true,
    },
    {
      id: 'connect',
      title: 'Bring in what you already use',
      body: 'Connect a hardware wallet, multisig, or exchange, or enter holdings yourself. You can also generate a statement of your holdings for any period.',
      preview: <AccountTypesPreview />,
      sample: false,
    },
    {
      id: 'watch-only',
      title: 'It can see, not spend',
      body: 'Wallets connect watch-only, and exchanges only need a read-only key. Control Center never asks for your seed phrase and can’t move your Bitcoin.',
      preview: <PermissionsPreview />,
      sample: true,
    },
    {
      id: 'privacy',
      title: 'Your data stays with you',
      body: desktop
        ? 'Your history is saved on this computer. Balances come from a public Electrum server or your own node, plus any exchanges you connect. No Hoseki account needed.'
        : 'Your history is saved on your server. Balances come from your node’s Electrum server, plus any exchanges you connect. No Hoseki account needed.',
      preview: <ConnectionsPreview />,
      sample: true,
    },
    {
      id: 'get-ready',
      title: 'Start with one account',
      body: 'Have one of these ready: your hardware wallet, a read-only API key from your exchange, or just your balance to enter by hand.',
      preview: <HomePreview />,
      sample: true,
    },
  ]
}
