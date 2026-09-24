import { Box, Button, HStack, Spinner, Stack, Text, chakra } from '@chakra-ui/react'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { CheckCircleFilledIcon, StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../../components/bitcoin-amount'
import { SensitiveValue } from '../../../components/sensitive-value'
import { trpc } from '../../../trpc'
import { needsExchangeReconnect } from '../../../utils/exchange-connection-status'

export function RobinhoodAccountDetailsPage(): JSX.Element {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const listQuery = trpc.portalProve.exchange.robinhood.list.useQuery()
  const refreshMutation = trpc.portalProve.exchange.refreshBalance.useMutation()
  const deleteMutation = trpc.portalProve.exchange.delete.useMutation()

  if (listQuery.isLoading) {
    return <Spinner mt={12} display="block" mx="auto" size="xl" />
  }

  const account = listQuery.data?.find((a) => a.id === accountId)

  if (!account) {
    return <ErrorBanner mt={8} mb={4} message="Robinhood account not found." />
  }

  const btcSats = account.balance ? Number(account.balance) : 0
  const btcAmount = (btcSats / 100_000_000).toFixed(8)
  const needsReconnect = needsExchangeReconnect(account)
  const accountDisplayName = account.displayName

  function handleReconnect(): void {
    if (!accountId) return
    navigate('/accounts/verify/robinhood', {
      state: {
        returnTo: `/accounts/robinhood/${accountId}`,
        replaceAccountId: accountId,
        displayName: accountDisplayName,
      },
    })
  }

  async function handleRefresh(): Promise<void> {
    if (!accountId) return
    setIsRefreshing(true)
    try {
      await refreshMutation.mutateAsync({ accountId })
      await utils.portalProve.exchange.robinhood.list.invalidate()
      await utils.portalProve.exchange.list.invalidate()
      toast.success('Balance refreshed')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh balance'
      toast.error(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!accountId) return
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync({ accountId })
      await utils.portalProve.exchange.robinhood.list.invalidate()
      await utils.portalProve.exchange.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      navigate('/accounts')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove account'
      toast.error(message)
      setIsDeleting(false)
    }
  }

  return (
    <Box py={6}>
      {/* Top bar */}
      <TopBar mb={6}>
        <TopBar.Back as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Back>
        <TopBar.Item as="button" color="status.error.fg" onClick={handleDelete}>
          {isDeleting ? 'Removing...' : 'Remove Account'}
        </TopBar.Item>
      </TopBar>

      <Stack spacing={4}>
        {/* Account name + status row */}
        <Box>
          <Text textStyle="text/md" fontWeight="medium" overflowWrap="anywhere">
            {account.displayName}
          </Text>
          <HStack spacing={1} flexWrap="wrap">
            <Box w={2} h={2} bg="status.success.solid" borderRadius="full" />
            <Text textStyle="text/xs" color="text.secondary">
              First Connected
            </Text>
            <Text textStyle="text/xs" color="text.primary" fontWeight="medium">
              {format(new Date(account.createdAt), 'MMMM do, yyyy')}
            </Text>
          </HStack>
        </Box>

        <hr />

        {/* Logo + metadata */}
        <Stack align="center" justify="center" w="full" maxW="640px" minW={0} mx="auto" mt={-4}>
          <Box mx="auto" pt={10} pb={6}>
            <chakra.img
              src="/images/exchanges/robinhood-icon.svg"
              alt="Robinhood"
              h="100px"
              display="block"
              opacity={needsReconnect ? 0.55 : 1}
              filter={needsReconnect ? 'grayscale(1)' : 'drop-shadow(-4px 6px 10px rgba(0, 0, 0, 0.2))'}
            />
          </Box>

          <HStack spacing={0} gap={4} mb={4} w="100%" alignItems="flex-start" flexWrap="wrap">
            {/* Amount */}
            <Box w={{ base: 'full', sm: 'calc(50% - 8px)' }} minW={0} overflowWrap="anywhere">
              <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
                Amount
              </Text>
              {account.balance === null ? (
                <Text textStyle="label/sm" color="text.tertiary" fontWeight="medium">
                  —
                </Text>
              ) : (
                <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
                  <SensitiveValue>
                    <BitcoinAmount btc={btcAmount} />
                  </SensitiveValue>
                </Text>
              )}
            </Box>

            {/* Status */}
            <Box w={{ base: 'full', sm: 'calc(50% - 8px)' }} minW={0} overflowWrap="anywhere">
              <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
                Status
              </Text>
              {needsReconnect ? (
                <StatusBadge status="warning" label="Reconnect Required" w="fit-content" />
              ) : (
                <StatusBadge status="success" label="Connected" icon={CheckCircleFilledIcon} w="fit-content" />
              )}
            </Box>

            {/* Account Type */}
            <Box w={{ base: 'full', sm: 'calc(50% - 8px)' }} minW={0} overflowWrap="anywhere">
              <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
                Account Type
              </Text>
              <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
                Custodial
              </Text>
            </Box>

            {/* Date Added */}
            <Box
              w={{ base: 'full', sm: 'calc(50% - 8px)' }}
              minW={0}
              overflowWrap="anywhere"
              textAlign={{ base: 'left', sm: 'right' }}
            >
              <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
                Date Added
              </Text>
              <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
                {format(new Date(account.createdAt), 'MMMM do, yyyy')}
              </Text>
            </Box>
          </HStack>

          {/* Refresh Balance */}
          <Box w="100%">
            {needsReconnect ? (
              <Button size="sm" onClick={handleReconnect}>
                Reconnect Account
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
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
