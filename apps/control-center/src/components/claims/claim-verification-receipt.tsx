import { Button, HStack, Text, VStack } from '@chakra-ui/react'
import { PageTransition } from '@hoseki/packages/ui/design-system'
import { ClaimCard, Receipt } from '@hoseki/packages/ui/prove-verify-ui'
import { useEffect, useState } from 'react'
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks'
import { useNavigate } from 'react-router'
import { useGetClaimBalance } from '../../lib/balances'
import { clearFlowSource, getFlowSource } from '../../lib/flow-tracker'
import { type ClaimDto } from '../../trpc/server-types'
import { mapClaimToClaimCardProps, withStatusBalance } from '../../utils/claim-utils'

type ClaimVerificationReceiptProps =
  | {
      shouldSetTimeout: false
      claim: null
    }
  | {
      shouldSetTimeout: true
      claim: ClaimDto
    }

export function ClaimVerificationReceipt({ shouldSetTimeout, claim }: ClaimVerificationReceiptProps): JSX.Element {
  const [isPending, setIsPending] = useState(true)
  const navigate = useNavigate()

  const balanceQuery = useGetClaimBalance(claim?.id ?? null, { enabled: !!claim?.id })

  const flowSource = getFlowSource()
  const isStatementFlow = flowSource?.type === 'statement'

  useEffect(() => {
    if (shouldSetTimeout) {
      setTimeout(() => {
        setIsPending(false)
      }, 1700)
    }
  }, [shouldSetTimeout])

  const handleNavigation = (path: string) => {
    clearFlowSource()
    void navigate(path)
  }

  if (isPending) {
    return (
      <PageTransition>
        <Receipt title="Validating Ownership..." state="loading" />
      </PageTransition>
    )
  }

  return (
    <PageTransition>
      <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />
      <Receipt
        title="Claim Verified!"
        state="success"
        onClose={() => {
          handleNavigation('/home')
        }}
        closeTitle="Back to Home"
        content={
          <VStack spacing={8}>
            {claim && (
              <ClaimCard
                {...mapClaimToClaimCardProps(claim)}
                balance={withStatusBalance({
                  ...balanceQuery,
                  balance: balanceQuery.data,
                })}
                pointerEvents="none"
                minWidth="300px"
                maxWidth="364px"
              />
            )}
            <Text textStyle="text/2xl" color="neutral.900" textAlign="center">
              Your {claim?.displayName ? `"${claim.displayName}" claim` : `claim`} is now verified and ready to include
              in ownership statements.
            </Text>
            <HStack spacing={4}>
              <Button
                variant="outline"
                onClick={() => {
                  handleNavigation('/accounts')
                }}
              >
                Connect Another Account
              </Button>
              <Button
                onClick={() => {
                  handleNavigation('/statements/create')
                }}
              >
                {isStatementFlow ? 'Complete Statement' : 'Generate Statement'}
              </Button>
            </HStack>
          </VStack>
        }
      />
    </PageTransition>
  )
}
