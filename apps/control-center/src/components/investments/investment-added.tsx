import { Flex, Text } from '@chakra-ui/react'
import Decimal from 'decimal.js'
import { useNavigate } from 'react-router'
import { useCountUpProgress } from '../../hooks/use-count-up-progress'
import { InvestmentIcon } from '../claims/account-type-media'
import { ConnectionPending, ConnectionSuccess } from '../claims/connection-success'
import { DashboardAmount } from '../dashboard/dashboard-typography'
import { formatInvestmentValue } from './value'

const hero = { icon: <InvestmentIcon boxSize={12} /> }

export function InvestmentsAdding(): JSX.Element {
  return <ConnectionPending title="Adding Your Investment..." hero={hero} />
}

/** The shared account celebration, showing USD without inventing a Bitcoin balance. */
export function InvestmentsAdded({ account }: { account: { id: string; valueCents: string } }): JSX.Element {
  const navigate = useNavigate()
  const progress = useCountUpProgress(true)
  const viewInvestments = (): void => {
    void navigate(`/accounts/investments/${account.id}`)
  }
  return (
    <ConnectionSuccess
      hero={hero}
      title="Investment Added!"
      subtitle="Its reported value now shows in Control Center."
      value={
        <Flex align="baseline" justify="center" gap={2} flexWrap="wrap">
          <DashboardAmount>
            {formatInvestmentValue(new Decimal(account.valueCents).mul(progress).floor().toFixed(0))}
          </DashboardAmount>
          <Text textStyle={{ base: 'text/lg', md: 'text/xl' }} fontWeight="medium" color="neutral.500">
            USD
          </Text>
        </Flex>
      }
      primary={{ label: 'View Investment', onClick: viewInvestments }}
      secondary={{
        label: 'Connect Another Account',
        onClick: () => {
          void navigate('/accounts/add')
        },
      }}
      onClose={viewInvestments}
      closeTitle="View Investment"
    />
  )
}
