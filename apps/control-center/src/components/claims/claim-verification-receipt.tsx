import { Button, Stack, Text, VStack } from '@chakra-ui/react'
import { PageTransition } from '@hoseki/packages/ui/design-system'
import { ClaimCard, Receipt } from '@hoseki/packages/ui/prove-verify-ui'
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
  const navigate = useNavigate()

  const balanceQuery = useGetClaimBalance(claim?.id ?? null, { enabled: !!claim?.id })

  const flowSource = getFlowSource()
  const isStatementFlow = flowSource?.type === 'statement'

  const handleNavigation = (path: string) => {
    clearFlowSource()
    navigate(path)
  }

  if (!shouldSetTimeout) {
    return (
      <PageTransition>
        <Receipt title="Loading verification…" state="loading" />
      </PageTransition>
    )
  }

  return (
    <PageTransition>
      <Receipt
        title="Account verified"
        state="success"
        onClose={() => handleNavigation('/portfolio')}
        closeTitle="Back to Portfolio"
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
                minWidth={0}
                w="full"
                maxWidth="364px"
              />
            )}
            <Text textStyle="text/md" color="text.primary" textAlign="center">
              Your {claim?.displayName ? `"${claim.displayName}" account` : `account`} is now verified and ready to
              include in ownership statements.
            </Text>
            <Stack direction={{ base: 'column', sm: 'row' }} justify="center" spacing={3} w="full">
              <Button variant="outline" onClick={() => handleNavigation('/accounts')}>
                Connect Another Account
              </Button>
              <Button onClick={() => handleNavigation(isStatementFlow ? '/statements/create' : '/portfolio')}>
                {isStatementFlow ? 'Complete Statement' : 'View Portfolio'}
              </Button>
            </Stack>
          </VStack>
        }
      />
    </PageTransition>
  )
}
