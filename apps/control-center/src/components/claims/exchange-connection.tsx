import { chakra } from '@chakra-ui/react'
import { useNavigate } from 'react-router'
import { useBalanceFromSats } from '../../lib/balances'
import { type ConnectionHero, ConnectionPending, ConnectionSuccess } from './connection-success'

type Exchange = 'coinbase' | 'kraken' | 'robinhood' | 'strike'

const exchanges = {
  coinbase: { name: 'Coinbase', icon: '/images/exchanges/coinbase.svg' },
  kraken: { name: 'Kraken', icon: '/images/exchanges/kraken.svg' },
  robinhood: { name: 'Robinhood', icon: '/images/exchanges/robinhood-icon.svg' },
  strike: { name: 'Strike', icon: '/images/exchanges/strike-icon.svg' },
} as const satisfies Record<Exchange, { name: string; icon: string }>

function exchangeHero(exchange: Exchange): ConnectionHero {
  const { icon } = exchanges[exchange]
  return { icon: <chakra.img src={icon} alt="" boxSize="56px" /> }
}

/** Shown while Sentinel checks the exchange's API key and reads its balance. */
export function ExchangeConnecting({ exchange }: { exchange: Exchange }): JSX.Element {
  return <ConnectionPending title={`Connecting to ${exchanges[exchange].name}...`} hero={exchangeHero(exchange)} />
}

/** Celebrates a newly connected or reconnected exchange, with the balance it reported on connecting. */
export function ExchangeConnected({
  exchange,
  account,
  isReconnect,
  returnTo,
}: {
  exchange: Exchange
  account: { id: string; balanceSats: string | null }
  isReconnect: boolean
  /** Where a reconnect started, usually the account's page. */
  returnTo: string
}): JSX.Element {
  const navigate = useNavigate()
  const balance = useBalanceFromSats(account.balanceSats)
  const { name } = exchanges[exchange]
  const viewAccount = () => {
    void navigate(isReconnect ? returnTo : `/accounts/${exchange}/${account.id}`)
  }

  return (
    <ConnectionSuccess
      hero={exchangeHero(exchange)}
      title={isReconnect ? `${name} Reconnected!` : `${name} Connected!`}
      subtitle={
        isReconnect
          ? 'Its balance and history are updating again.'
          : 'Its balance and history now show in Control Center.'
      }
      balance={balance}
      primary={{ label: `View ${name}`, onClick: viewAccount }}
      {...(!isReconnect && {
        secondary: {
          label: 'Connect Another Account',
          onClick: () => {
            void navigate('/accounts/add')
          },
        },
      })}
      onClose={viewAccount}
      closeTitle={`View ${name}`}
    />
  )
}
