import { useNavigate } from 'react-router'
import { useBalanceFromSats } from '../../lib/balances'
import { EtfHoldingsIcon, ManualEntryIcon } from './account-type-media'
import { type ConnectionHero, ConnectionPending, ConnectionSuccess } from './connection-success'

type HoldingsKind = 'manual' | 'etf'

const holdings = {
  manual: {
    pending: 'Adding Your Holdings...',
    title: 'Holdings Added!',
    subtitle: 'Their balance now shows in Control Center.',
    hero: { icon: <ManualEntryIcon boxSize={12} /> },
  },
  etf: {
    pending: 'Adding Your ETF Holdings...',
    title: 'ETF Holdings Added!',
    subtitle: 'The bitcoin they hold for you now shows in Control Center.',
    hero: { icon: <EtfHoldingsIcon boxSize={12} /> },
  },
} as const satisfies Record<HoldingsKind, { pending: string; title: string; subtitle: string; hero: ConnectionHero }>

/**
 * Resolves with `promise`, but no sooner than a second, so a save that finishes at once doesn't flash its
 * pending screen.
 */
export async function afterAtLeastASecond<T>(promise: Promise<T>): Promise<T> {
  const [result] = await Promise.all([
    promise,
    new Promise((resolve) => {
      setTimeout(resolve, 1_000)
    }),
  ])
  return result
}

/** Shown while Sentinel saves holdings entered by hand. */
export function HoldingsAdding({ kind }: { kind: HoldingsKind }): JSX.Element {
  return <ConnectionPending title={holdings[kind].pending} hero={holdings[kind].hero} />
}

/** Celebrates holdings entered by hand, with the bitcoin they add up to. */
export function HoldingsAdded({
  kind,
  account,
}: {
  kind: HoldingsKind
  account: { id: string; balance: string | null }
}): JSX.Element {
  const navigate = useNavigate()
  const balance = useBalanceFromSats(account.balance)
  const { title, subtitle, hero } = holdings[kind]
  const viewHoldings = () => {
    void navigate(`/accounts/${kind}/${account.id}`)
  }

  return (
    <ConnectionSuccess
      hero={hero}
      title={title}
      subtitle={subtitle}
      balance={balance}
      primary={{ label: 'View Holdings', onClick: viewHoldings }}
      secondary={{
        label: 'Connect Another Account',
        onClick: () => {
          void navigate('/accounts/add')
        },
      }}
      onClose={viewHoldings}
      closeTitle="View Holdings"
    />
  )
}
