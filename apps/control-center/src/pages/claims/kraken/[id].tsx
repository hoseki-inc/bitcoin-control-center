import { Box, Button, HStack, Spinner, Stack, Text, chakra } from '@chakra-ui/react'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { CheckCircleFilledIcon, StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../../components/bitcoin-amount'
import { trpc } from '../../../trpc'
import { needsExchangeReconnect } from '../../../utils/exchange-connection-status'

export function KrakenAccountDetailsPage(): JSX.Element {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const listQuery = trpc.portalProve.exchange.kraken.list.useQuery()
  const refreshMutation = trpc.portalProve.exchange.refreshBalance.useMutation()
  const deleteMutation = trpc.portalProve.exchange.delete.useMutation()

  if (listQuery.isLoading) {
    return <Spinner mt={12} display="block" mx="auto" size="xl" />
  }

  const account = listQuery.data?.find((a) => a.id === accountId)

  if (!account) {
    return <ErrorBanner mt={8} mb={4} message="Kraken account not found." />
  }

  const btcSats = account.balance != null && account.balance !== '' ? Number(account.balance) : 0
  const btcAmount = (btcSats / 100_000_000).toFixed(8)
  const needsReconnect = needsExchangeReconnect(account)

  function handleReconnect(): void {
    if (accountId == null || accountId === '') {
      return
    }
    void navigate('/accounts/verify/kraken', {
      state: { returnTo: `/accounts/kraken/${accountId}`, replaceAccountId: accountId },
    })
  }

  async function handleRefresh(): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    setIsRefreshing(true)
    try {
      await refreshMutation.mutateAsync({ accountId })
      await utils.portalProve.exchange.kraken.list.invalidate()
      toast.success('Balance refreshed')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh balance'
      toast.error(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync({ accountId })
      await utils.portalProve.exchange.kraken.list.invalidate()
      await utils.portalProve.exchange.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      void navigate('/accounts')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove account'
      toast.error(message)
      setIsDeleting(false)
    }
  }

  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Item>
        <TopBar.Item
          as="button"
          color="error.600"
          onClick={() => {
            void handleDelete()
          }}
        >
          {isDeleting ? 'Removing...' : 'Remove Account'}
        </TopBar.Item>
      </TopBar>

      <Stack spacing={4}>
        <Box>
          <Text textStyle="text/md" fontWeight="medium" overflowWrap="anywhere">
            {account.displayName}
          </Text>
          <HStack spacing={1} flexWrap="wrap">
            <Box w={2} h={2} bg="success.600" borderRadius="full" />
            <Text textStyle="text/xs" color="neutral.600">
              First Connected
            </Text>
            <Text textStyle="text/xs" color="neutral.900" fontWeight="medium">
              {format(new Date(account.createdAt), 'MMMM do, yyyy')}
            </Text>
          </HStack>
        </Box>

        <hr />

        <Stack align="center" justify="center" w="full" maxW="640px" minW={0} mx="auto" mt={-4}>
          <Box mx="auto" pt={10} pb={6}>
            <chakra.img
              src="/images/exchanges/kraken.svg"
              alt="Kraken"
              h="100px"
              display="block"
              opacity={needsReconnect ? 0.55 : 1}
              filter={needsReconnect ? 'grayscale(1)' : 'drop-shadow(-4px 6px 10px rgba(0, 0, 0, 0.2))'}
            />
          </Box>

          <HStack spacing={0} gap={4} mb={4} w="100%" alignItems="flex-start" flexWrap="wrap">
            <Box w={{ base: 'full', sm: 'calc(50% - 8px)' }} minW={0} overflowWrap="anywhere">
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Amount
              </Text>
              {account.balance === null ? (
                <Text textStyle="label/sm" color="neutral.400" fontWeight="medium">
                  —
                </Text>
              ) : (
                <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                  <>
                    <BitcoinAmount btc={btcAmount} />
                  </>
                </Text>
              )}
            </Box>

            <Box w={{ base: 'full', sm: 'calc(50% - 8px)' }} minW={0} overflowWrap="anywhere">
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Status
              </Text>
              {needsReconnect ? (
                <StatusBadge status="warning" label="Reconnect Required" w="fit-content" />
              ) : (
                <StatusBadge status="success" label="Connected" icon={CheckCircleFilledIcon} w="fit-content" />
              )}
            </Box>

            <Box w={{ base: 'full', sm: 'calc(50% - 8px)' }} minW={0} overflowWrap="anywhere">
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Account Type
              </Text>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                Custodial
              </Text>
            </Box>

            <Box
              w={{ base: 'full', sm: 'calc(50% - 8px)' }}
              minW={0}
              overflowWrap="anywhere"
              textAlign={{ base: 'left', sm: 'right' }}
            >
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Date Added
              </Text>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                {format(new Date(account.createdAt), 'MMMM do, yyyy')}
              </Text>
            </Box>
          </HStack>

          <Box w="100%">
            {needsReconnect ? (
              <Button size="sm" onClick={handleReconnect}>
                Reconnect Account
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleRefresh()
                }}
                isLoading={isRefreshing}
                loadingText="Refreshing..."
              >
                Refresh Balance
              </Button>
            )}
          </Box>
        </Stack>
      </Stack>
    </Box>
  )
}
