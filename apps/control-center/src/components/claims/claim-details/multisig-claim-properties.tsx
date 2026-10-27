import { Box, Flex, Spinner, Stack, type StackProps, Text } from '@chakra-ui/react'
import { Account, MultiSigAccount } from '@hoseki/packages/bitcoin'
import { StatusBadge, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { formatUsd, toBitcoinAmountDisplayValue } from '@hoseki/packages/ui/utils'
import { useGetClaimBalance } from '../../../lib/balances'
import type { ClaimDto } from '../../../trpc/server-types'
import { ensureClaimStatusNotExpired, isBitkeyClaim } from '../../../utils/claim-utils'

export function MultisigClaimProperties({ claim, ...props }: { claim: ClaimDto } & StackProps): JSX.Element {
  const { data: balance, isLoading: isBalanceLoading } = useGetClaimBalance(claim.id)

  const account = Account.fromCheckedDescriptor(claim.account)
  const isMultisig = account instanceof MultiSigAccount
  const threshold = isMultisig ? account.threshold : 1

  const claimStatus = ensureClaimStatusNotExpired(claim)

  return (
    <Stack spacing={4} mb={8} {...props}>
      <Text as="h2" textStyle="text/md" fontWeight="medium">
        Claim Details
      </Text>
      <Flex flexDirection="row" flexWrap="wrap">
        <Box w={['50%', '30%']} boxSizing="border-box" pb={[4, 0]}>
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Status
          </Text>
          <StatusBadge {...getBadgeConfigForClaim(claimStatus)} w="fit-content" />
        </Box>
        <Box w={['50%', '30%']} boxSizing="border-box" pb={[4, 0]}>
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Amount
          </Text>
          {isBalanceLoading ? (
            <Spinner size="xs" />
          ) : (
            <>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium" whiteSpace="nowrap">
                {balance?.current ? toBitcoinAmountDisplayValue(balance.current.toString()) : 'n/a'}
              </Text>
              {balance?.usd && (
                <Text textStyle="label/sm" color="success.600" fontWeight="medium">
                  {formatUsd(balance.usd.toFixed(2))}
                </Text>
              )}
            </>
          )}
        </Box>
        <Box w={['50%', '30%']} boxSizing="border-box">
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1} whiteSpace="nowrap">
            Claim Type
          </Text>
          <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
            {isBitkeyClaim(claim) ? 'Bitkey' : isMultisig ? 'Multisig' : 'Singlesig'}
          </Text>
        </Box>
        <Box w={['50%', '10%']} textAlign={['left', 'right']} boxSizing="border-box">
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Quorum
          </Text>
          <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
            {threshold} of {claim.keystores.length}
          </Text>
        </Box>
      </Flex>
    </Stack>
  )
}
