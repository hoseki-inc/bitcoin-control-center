import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Icon,
  Input,
  Select,
  Spinner,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react'
import { ETF_CONFIGS, ETF_TICKERS, type EtfTicker, getEtfConfig } from '@hoseki/packages/etfs/holdings'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { trpc } from '../../../trpc'

export function EtfAccountDetailsPage(): JSX.Element {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const [isDeleting, setIsDeleting] = useState(false)

  // ─── Add Holding form ────────────────────────────────────────
  const [newTicker, setNewTicker] = useState<EtfTicker>('IBIT')
  const [newShares, setNewShares] = useState('')
  const [newDatePurchased, setNewDatePurchased] = useState('')

  // ─── Queries ────────────────────────────────────────────────
  const accountQuery = trpc.portalProve.etf.get.useQuery({ accountId: accountId ?? '' }, { enabled: !!accountId })
  const holdingsQuery = trpc.portalProve.etf.holdings.list.useQuery(
    { accountId: accountId ?? '' },
    { enabled: !!accountId },
  )

  // ─── Mutations ──────────────────────────────────────────────
  const addHoldingMutation = trpc.portalProve.etf.holdings.add.useMutation()
  const removeHoldingMutation = trpc.portalProve.etf.holdings.remove.useMutation()
  const deleteMutation = trpc.portalProve.etf.delete.useMutation()

  if (accountQuery.isLoading) {
    return <Spinner mt={12} display="block" mx="auto" size="xl" />
  }

  const account = accountQuery.data
  if (!account) {
    return <ErrorBanner mt={8} mb={4} message="ETF account not found." />
  }

  const btcSats = account.balance ? Number(account.balance) : 0
  const btcAmount = (btcSats / 100_000_000).toFixed(8)

  async function invalidateAll(): Promise<void> {
    if (!accountId) {
      return
    }
    await utils.portalProve.etf.get.invalidate({ accountId })
    await utils.portalProve.etf.list.invalidate()
    await utils.portalProve.etf.holdings.list.invalidate({ accountId })
    await utils.portalProve.controlCenter.invalidate()
  }

  async function handleAddHolding(): Promise<void> {
    if (!accountId || !newShares) {
      return
    }
    try {
      await addHoldingMutation.mutateAsync({
        accountId,
        ticker: newTicker,
        shares: newShares,
        datePurchased: newDatePurchased ? new Date(newDatePurchased + 'T12:00:00').toISOString() : undefined,
      })
      await invalidateAll()
      setNewShares('')
      setNewDatePurchased('')
      toast.success('Holding added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add holding')
    }
  }

  async function handleRemoveHolding(holdingId: string): Promise<void> {
    try {
      await removeHoldingMutation.mutateAsync({ holdingId })
      await invalidateAll()
      toast.success('Holding removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove holding')
    }
  }

  async function handleDelete(): Promise<void> {
    if (!accountId) {
      return
    }
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync({ accountId })
      await utils.portalProve.etf.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      void navigate('/accounts')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove account')
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

      <Stack spacing={6}>
        {/* Account header */}
        <Box>
          <HStack spacing={3} mb={1}>
            <ManualIcon />
            <Text textStyle="text/md" fontWeight="medium">
              {account.displayName}
            </Text>
          </HStack>
          <HStack spacing={1}>
            <Box w={2} h={2} bg="warning.500" borderRadius="full" />
            <Text textStyle="text/xs" color="warning.600" fontWeight="medium">
              Manually Added
            </Text>
            {account.createdAt && (
              <>
                <Text textStyle="text/xs" color="neutral.400">
                  ·
                </Text>
                <Text textStyle="text/xs" color="neutral.600">
                  {format(new Date(account.createdAt), 'MMMM do, yyyy')}
                </Text>
              </>
            )}
          </HStack>
        </Box>

        <hr />

        {/* Balance display */}
        <Stack align="center" maxW="640px" mx="auto" w="100%">
          <HStack spacing={4} mb={4} w="100%" alignItems="flex-start">
            <Box w={['100%', '50%', '33%']}>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Computed Balance
              </Text>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                {btcAmount} BTC
              </Text>
            </Box>
            <Box w={['100%', '50%', '33%']}>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Status
              </Text>
              <HStack spacing={1}>
                <Box w={2} h={2} bg="warning.500" borderRadius="full" />
                <Text textStyle="text/xs" color="warning.600" fontWeight="medium">
                  Manually Added
                </Text>
              </HStack>
            </Box>
          </HStack>
        </Stack>

        <hr />

        {/* Holdings table */}
        {holdingsQuery.data && holdingsQuery.data.length > 0 && (
          <Box maxW="740px" mx="auto" w="100%">
            <Heading textStyle="text/lg" fontWeight="semibold" mb={3}>
              Holdings
            </Heading>
            <Box borderWidth="1px" borderColor="neutral.200" borderRadius="md" overflow="hidden">
              <Table size="sm">
                <Thead>
                  <Tr>
                    <Th>Ticker</Th>
                    <Th>Issuer</Th>
                    <Th>Shares</Th>
                    <Th>BTC/Share</Th>
                    <Th>BTC Amount</Th>
                    <Th>Purchased</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {holdingsQuery.data.map((holding) => {
                    const config = getEtfConfig(holding.ticker)
                    return (
                      <Tr key={holding.id}>
                        <Td>
                          <Text textStyle="text/xs" fontWeight="semibold">
                            {holding.ticker}
                          </Text>
                        </Td>
                        <Td>
                          <Text textStyle="text/xs" color="neutral.500">
                            {config?.issuer ?? '—'}
                          </Text>
                        </Td>
                        <Td>
                          <Text textStyle="text/xs">{holding.shares}</Text>
                        </Td>
                        <Td>
                          <Text textStyle="text/xs" fontFamily="mono">
                            {holding.btcPerShare.toFixed(8)}
                          </Text>
                        </Td>
                        <Td>
                          <Text textStyle="text/xs" fontFamily="mono">
                            {(Number(holding.btcSats) / 1e8).toFixed(8)}
                          </Text>
                        </Td>
                        <Td>
                          <Text textStyle="text/xs" color="neutral.500">
                            {holding.datePurchased ? format(new Date(holding.datePurchased), 'MMM d, yyyy') : '—'}
                          </Text>
                        </Td>
                        <Td>
                          <Button
                            size="xs"
                            variant="ghost"
                            color="error.500"
                            onClick={() => {
                              void handleRemoveHolding(holding.id)
                            }}
                          >
                            Remove
                          </Button>
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </Box>
          </Box>
        )}

        <hr />

        {/* Add Holding */}
        <Box maxW="740px" mx="auto" w="100%">
          <Heading textStyle="text/lg" fontWeight="semibold" mb={3}>
            Add Holding
          </Heading>
          <HStack spacing={3} align="flex-end">
            <FormControl flex={1.2}>
              <FormLabel textStyle="text/xs" color="neutral.600">
                ETF
              </FormLabel>
              <Select
                size="sm"
                value={newTicker}
                onChange={(e) => {
                  const ticker = ETF_TICKERS.find((candidate) => candidate === e.target.value)
                  if (ticker) {
                    setNewTicker(ticker)
                  }
                }}
              >
                {ETF_TICKERS.map((ticker) => {
                  const config = ETF_CONFIGS[ticker]
                  return (
                    <option key={ticker} value={ticker}>
                      {ticker} — {config.name}
                    </option>
                  )
                })}
              </Select>
            </FormControl>
            <FormControl flex={0.8}>
              <FormLabel textStyle="text/xs" color="neutral.600">
                Shares
              </FormLabel>
              <Input
                size="sm"
                type="number"
                step="any"
                min="0"
                placeholder="0"
                value={newShares}
                onChange={(e) => {
                  setNewShares(e.target.value)
                }}
              />
            </FormControl>
            <FormControl flex={0.8}>
              <FormLabel textStyle="text/xs" color="neutral.600">
                Date Purchased
              </FormLabel>
              <Input
                size="sm"
                type="date"
                value={newDatePurchased}
                onChange={(e) => {
                  setNewDatePurchased(e.target.value)
                }}
              />
            </FormControl>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void handleAddHolding()
              }}
              isLoading={addHoldingMutation.isLoading}
              isDisabled={!newShares}
            >
              Add
            </Button>
          </HStack>
        </Box>
      </Stack>
    </Box>
  )
}

function ManualIcon(): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" w={5} h={5} color="warning.500">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <polyline
        points="14 2 14 8 20 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  )
}
