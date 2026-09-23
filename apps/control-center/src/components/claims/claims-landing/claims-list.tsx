import { Grid, Stack } from '@chakra-ui/react'
import { ClaimCard } from '@hoseki/packages/ui/prove-verify-ui'
import { Link } from 'react-router'
import { useGetBalancesPerClaimIds } from '../../../lib/balances'
import { type ClaimDto } from '../../../trpc/server-types'
import { mapClaimToClaimCardProps, withStatusBalance } from '../../../utils/claim-utils'

export function ClaimsList({ claims }: { claims: ClaimDto[] }): JSX.Element {
  // Fetch balances separately to show claim card asap and display balances asynchronously.
  const claimIds = claims.map((claim) => claim.id) ?? []
  const claimUsdBalancesQuery = useGetBalancesPerClaimIds({ claimIds, enabled: claimIds.length > 0 })

  return (
    <Stack gap={4}>
      <Grid
        templateColumns={{
          base: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(3, minmax(0, 1fr))',
        }}
        gap={8}
      >
        {claims.map((claim) => {
          const isPendingMultisigClaim = claim.keystores.length > 1 && claim.status === 'pending'

          return (
            <ClaimCard
              {...mapClaimToClaimCardProps(claim)}
              as={Link}
              to={isPendingMultisigClaim ? `/multisig/${claim.id}` : `/accounts/${claim.id}`}
              key={claim.id}
              balance={withStatusBalance({
                isLoading: claimUsdBalancesQuery.isLoading,
                isSuccess: claimUsdBalancesQuery.isSuccess,
                balance: claimUsdBalancesQuery.data.get(claim.id),
              })}
              _hover={{
                borderColor: 'border.subtle',
                bgColor: 'surface.subtle',
                cursor: 'pointer',
              }}
            />
          )
        })}
      </Grid>
    </Stack>
  )
}
