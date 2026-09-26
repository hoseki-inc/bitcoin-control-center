import {
  Box,
  Button,
  Checkbox,
  HStack,
  Image,
  Stack,
  type StackProps,
  Table,
  Tbody,
  Td,
  Text,
  Tfoot,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react'
import type { BalanceWithStatus } from '@hoseki/packages/lib/balance'
import type { ClaimId } from '@hoseki/packages/schemas'
import { ErrorInline, Spinner } from '@hoseki/packages/ui/design-system'
import { LoadingTextSkeleton } from '@hoseki/packages/ui/prove-verify-ui/claims/loading-text-skeleton'
import { formatUsd, toBitcoinAmountDisplayValue } from '@hoseki/packages/ui/utils'
import Decimal from 'decimal.js'
import { PlusIcon } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router'
import { useGetBalancesPerClaimIds } from '../../lib/balances'
import { setIsInGenerateStatementFlow } from '../../lib/flow-tracker'
import { trpc } from '../../trpc'
import { withStatusBalance } from '../../utils/claim-utils'
import { isExchangeConnected, needsExchangeReconnect } from '../../utils/exchange-connection-status'

interface ClaimSelectionProps extends StackProps {
  disabledClaims?: Set<string>
  selectedClaimIds: Set<ClaimId>
  setSelectedClaimIds: Dispatch<SetStateAction<Set<ClaimId>>>
  selectedExchangeAccountIds: Set<string>
  setSelectedExchangeAccountIds: Dispatch<SetStateAction<Set<string>>>
}
export function ClaimSelection({
  disabledClaims,
  selectedClaimIds,
  setSelectedClaimIds,
  selectedExchangeAccountIds,
  setSelectedExchangeAccountIds,
  ...props
}: ClaimSelectionProps): JSX.Element {
  const showExchanges = true
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: true })
  const claimIds = claimsQuery.data?.map((claim) => claim.id) ?? []
  const claimUsdBalancesQuery = useGetBalancesPerClaimIds({ claimIds, enabled: claimIds.length > 0 })
  const exchangeAccountsQuery = trpc.portalProve.exchange.list.useQuery(undefined, { enabled: showExchanges })
  const btcPriceQuery = trpc.portalProve.retrieveBitcoinPrice.useQuery(undefined, { enabled: showExchanges })

  const exchangeAccounts = exchangeAccountsQuery.data ?? []
  const btcUsdPrice = btcPriceQuery.data?.value ? Number(btcPriceQuery.data.value) : null

  const handleClaimToggle = (claimId: ClaimId) => {
    setSelectedClaimIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(claimId)) {
        newSet.delete(claimId)
      } else {
        newSet.add(claimId)
      }
      return newSet
    })
  }

  const handleExchangeToggle = (accountId: string) => {
    setSelectedExchangeAccountIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(accountId)) {
        newSet.delete(accountId)
      } else {
        newSet.add(accountId)
      }
      return newSet
    })
  }

  const handleAddClaim = () => {
    setIsInGenerateStatementFlow()
  }

  if (claimsQuery.isLoading) {
    return (
      <Stack textAlign="center" gap={6} {...props}>
        <Spinner fullPage />
      </Stack>
    )
  }

  if (claimsQuery.isError) {
    return (
      <ErrorInline
        mb={4}
        variant="neutral"
        title="Error loading accounts"
        message="Please try again. If the issue continues, reach out to us at support@hoseki.app."
        otherContent={
          <Button as={Link} to="/accounts">
            Connect Your First Account
          </Button>
        }
      />
    )
  }

  let totalUsdSelected = new Decimal(0)
  for (const [claimId, balance] of claimUsdBalancesQuery.data.entries()) {
    if (balance?.usd && selectedClaimIds.has(claimId)) {
      totalUsdSelected = totalUsdSelected.plus(balance.usd)
    }
  }
  for (const account of exchangeAccounts) {
    if (
      isExchangeConnected(account) &&
      selectedExchangeAccountIds.has(account.id) &&
      account.balance != null &&
      account.balance !== '' &&
      btcUsdPrice !== null
    ) {
      const btcAmount = Number(account.balance) / 100_000_000
      totalUsdSelected = totalUsdSelected.plus(new Decimal(btcAmount).mul(btcUsdPrice))
    }
  }

  const claims = claimsQuery.data

  if (!claims.length && exchangeAccounts.length === 0) {
    return (
      <Box {...props}>
        <Image
          src="/empty-view/select-claims-for-statement-empty-state.png"
          alt="Once done, your verified holdings will appear here."
        />
      </Box>
    )
  }

  return (
    <Stack textAlign="center" gap={8} {...props}>
      <Table variant="simple">
        <Thead>
          <Tr>
            <Th px={0}>
              <Text textStyle="overline/sm" fontWeight={600} color="neutral.600">
                Accounts
              </Text>
            </Th>
            <Th px={0} isNumeric>
              <Text textStyle="overline/sm" fontWeight={600} color="neutral.600">
                BTC
              </Text>
            </Th>
            <Th px={0} isNumeric>
              <Text textStyle="overline/sm" fontWeight={600} color="neutral.600">
                USD
              </Text>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {claims.map((claim) => {
            const balanceWithStatus = withStatusBalance({
              ...claimUsdBalancesQuery,
              balance: claimUsdBalancesQuery.data.get(claim.id),
            })

            return (
              <Tr key={claim.id}>
                <Td px={0} maxW={0} w="55%">
                  <HStack>
                    <Checkbox
                      id={`claim_${claim.id}`}
                      isChecked={(disabledClaims?.has(claim.id) ?? false) || selectedClaimIds.has(claim.id)}
                      isDisabled={disabledClaims?.has(claim.id)}
                      onChange={() => {
                        handleClaimToggle(claim.id)
                      }}
                    />
                    <Stack gap={0} overflow="hidden" minW={0} flex={1}>
                      <Text
                        as="label"
                        htmlFor={`claim_${claim.id}`}
                        textStyle="text/sm"
                        fontWeight="medium"
                        noOfLines={1}
                        isTruncated
                        color="neutral.600"
                      >
                        {claim.displayName}
                      </Text>
                    </Stack>
                  </HStack>
                </Td>
                <Td px={0} isNumeric>
                  <Text textStyle="text/sm" fontWeight="medium" whiteSpace="nowrap">
                    {renderBalance(balanceWithStatus)}
                  </Text>
                </Td>
                <Td px={0} isNumeric>
                  {renderUsdAmount(balanceWithStatus)}
                </Td>
              </Tr>
            )
          })}
          {exchangeAccounts.map((account) => {
            const needsReconnect = needsExchangeReconnect(account)
            const btcSats = account.balance != null && account.balance !== '' ? Number(account.balance) : 0
            const btcAmount = btcSats / 100_000_000
            const usdAmount = btcUsdPrice !== null ? btcAmount * btcUsdPrice : null

            return (
              <Tr key={account.id}>
                <Td px={0} maxW={0} w="55%">
                  <HStack>
                    <Checkbox
                      id={`exchange_${account.id}`}
                      isChecked={!needsReconnect && selectedExchangeAccountIds.has(account.id)}
                      isDisabled={needsReconnect}
                      onChange={() => {
                        handleExchangeToggle(account.id)
                      }}
                    />
                    <Stack gap={0} overflow="hidden" minW={0} flex={1}>
                      <Text
                        as="label"
                        htmlFor={`exchange_${account.id}`}
                        textStyle="text/sm"
                        fontWeight="medium"
                        noOfLines={1}
                        isTruncated
                        color="neutral.600"
                      >
                        {account.exchange.charAt(0).toUpperCase() + account.exchange.slice(1)}
                      </Text>
                      {needsReconnect && (
                        <Text textStyle="text/xs" color="warning.600">
                          Reconnect
                        </Text>
                      )}
                    </Stack>
                  </HStack>
                </Td>
                <Td px={0} isNumeric>
                  <Text textStyle="text/sm" fontWeight="medium" whiteSpace="nowrap">
                    {needsReconnect ? '—' : toBitcoinAmountDisplayValue(btcSats.toString())}
                  </Text>
                </Td>
                <Td px={0} isNumeric>
                  <Text textStyle="text/sm" fontWeight="medium" color="success.600" whiteSpace="nowrap">
                    {!needsReconnect && usdAmount !== null ? formatUsd(usdAmount.toFixed(2)) : '—'}
                  </Text>
                </Td>
              </Tr>
            )
          })}
          <Tr>
            <Td px={0} colSpan={3}>
              <HStack textStyle="text/sm" fontWeight="regular" color="neutral.600">
                <PlusIcon size="18px" />
                {/* React Router supplies the anchor href from to; Oxlint cannot infer that for event rules. */}
                {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <Link to="/accounts" onClick={handleAddClaim}>
                  Add account
                </Link>
              </HStack>
            </Td>
          </Tr>
        </Tbody>
        <Tfoot>
          <Tr>
            <Th px={0}>
              <Text textTransform="none" textStyle="text/md" fontWeight="medium" color="neutral.900">
                Total
              </Text>
            </Th>
            <Th px={0} isNumeric colSpan={2}>
              <Text textStyle="text/md" fontWeight="medium" color="success.600">
                {formatUsd(totalUsdSelected.toFixed(2))}
              </Text>
            </Th>
          </Tr>
        </Tfoot>
      </Table>
    </Stack>
  )
}

function renderBalance(balance: BalanceWithStatus) {
  if (balance.status === 'loading') {
    return <LoadingTextSkeleton width="8em" />
  }
  if (balance.status === 'fail') {
    return 'n/a'
  }
  return toBitcoinAmountDisplayValue(balance.value.current.toString())
}

function renderUsdAmount(balance: BalanceWithStatus) {
  if (balance.status === 'loading') {
    return (
      <Text textStyle="text/sm" fontWeight="medium">
        <LoadingTextSkeleton width="5em" />
      </Text>
    )
  }
  if (balance.status === 'fail' || balance.value.usd === null) {
    return (
      <Text textStyle="text/sm" fontWeight="medium">
        &apos;n/a&apos;
      </Text>
    )
  }
  return (
    <Text textStyle="text/sm" fontWeight="medium" color="success.600" whiteSpace="nowrap">
      {formatUsd(balance.value.usd.toFixed(2))}
    </Text>
  )
}
