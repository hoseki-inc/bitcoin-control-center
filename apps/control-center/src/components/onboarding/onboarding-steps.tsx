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
}

/** The introduction's steps. Where data comes from differs between the desktop app and a server install. */
export function onboardingSteps(desktop: boolean): OnboardingStep[] {
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
    {
      id: 'get-ready',
      title: 'Start with one account',
      body: 'Have one of these ready: your hardware wallet, a read-only API key from your exchange, or just your balance to enter by hand.',
      preview: <HomePreview />,
    },
  ]
}
