import {
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  HStack,
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
  VisuallyHidden,
} from '@chakra-ui/react'
import { ETF_CONFIGS, ETF_TICKERS, type EtfTicker, getEtfConfig } from '@hoseki/packages/etfs/holdings'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { DateStringInput } from '@hoseki/packages/ui/design-system/forms/date-string-input'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { ChartNoAxesCombined } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../../components/bitcoin-amount'
import { SensitiveValue } from '../../../components/sensitive-value'
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
  const accountQuery = trpc.portalProve.etf.get.useQuery(
    { accountId: accountId ?? '' },
    { enabled: accountId != null && accountId !== '' },
  )
  const holdingsQuery = trpc.portalProve.etf.holdings.list.useQuery(
    { accountId: accountId ?? '' },
    { enabled: accountId != null && accountId !== '' },
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
    if (accountId == null || accountId === '') {
      return
    }
    await utils.portalProve.etf.get.invalidate({ accountId })
    await utils.portalProve.etf.list.invalidate()
    await utils.portalProve.etf.holdings.list.invalidate({ accountId })
    await utils.portalProve.controlCenter.invalidate()
  }

  async function handleAddHolding(): Promise<void> {
    if (accountId == null || accountId === '' || !newShares) {
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
    if (accountId == null || accountId === '') {
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
    <Box py={{ base: 6, md: 8 }} maxW="960px" w="full" mx="auto">
      <TopBar mb={8}>
        <TopBar.Back as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Back>
        <TopBar.Item
          as="button"
          color="status.error.fg"
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
            <Box color="text.secondary">
              <ChartNoAxesCombined size={24} aria-hidden="true" />
            </Box>
            <PageHeading title={account.displayName} />
          </HStack>
          <HStack spacing={1}>
            <Box w={2} h={2} bg="status.warning.solid" borderRadius="full" />
            <Text textStyle="text/sm" color="status.warning.fg" fontWeight="medium">
              Manually Added
            </Text>
            {account.createdAt && (
              <>
                <Text textStyle="text/sm" color="text.tertiary">
                  ·
                </Text>
                <Text textStyle="text/sm" color="text.secondary">
                  {format(new Date(account.createdAt), 'MMMM do, yyyy')}
                </Text>
              </>
            )}
          </HStack>
        </Box>

        <Divider borderColor="border.subtle" />

        <Box>
          <Text textStyle="text/sm" color="text.secondary" mb={1}>
            Computed balance
          </Text>
          <Text textStyle="text/xl" fontWeight="medium" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            <SensitiveValue>
              <BitcoinAmount btc={btcAmount} />
            </SensitiveValue>
          </Text>
        </Box>
        <Divider borderColor="border.subtle" />

        {/* Holdings table */}
        {holdingsQuery.data && holdingsQuery.data.length > 0 && (
          <Box w="100%">
            <Text as="h2" textStyle="text/md" fontWeight="medium" mb={4}>
              Holdings
            </Text>
            <Box borderWidth="1px" borderColor="border.subtle" borderRadius="panel" overflowX="auto">
              <Table variant="data" size="md" aria-label="ETF holdings">
                <Thead>
                  <Tr>
                    <Th scope="col">Ticker</Th>
                    <Th scope="col">Issuer</Th>
                    <Th scope="col" isNumeric>
                      Shares
                    </Th>
                    <Th scope="col" isNumeric>
                      Bitcoin/share
                    </Th>
                    <Th scope="col" isNumeric>
                      Bitcoin amount
                    </Th>
                    <Th scope="col">Purchased</Th>
                    <Th scope="col">
                      <VisuallyHidden>Actions</VisuallyHidden>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {holdingsQuery.data.map((holding) => {
                    const config = getEtfConfig(holding.ticker)
                    return (
                      <Tr key={holding.id}>
                        <Td>
                          <Text textStyle="text/sm" fontWeight="medium">
                            {holding.ticker}
                          </Text>
                        </Td>
                        <Td>
                          <Text textStyle="text/sm" color="text.secondary">
                            {config?.issuer ?? '—'}
                          </Text>
                        </Td>
                        <Td isNumeric>
                          <SensitiveValue>{holding.shares}</SensitiveValue>
                        </Td>
                        <Td isNumeric>
                          <SensitiveValue>
                            <BitcoinAmount btc={holding.btcPerShare} />
                          </SensitiveValue>
                        </Td>
                        <Td isNumeric>
                          <SensitiveValue>
                            <BitcoinAmount btc={Number(holding.btcSats) / 1e8} />
                          </SensitiveValue>
                        </Td>
                        <Td>
                          <Text textStyle="text/sm" color="text.secondary">
                            {holding.datePurchased != null && holding.datePurchased !== ''
                              ? format(new Date(holding.datePurchased), 'MMM d, yyyy')
                              : '—'}
                          </Text>
                        </Td>
                        <Td>
                          <Button
                            size="sm"
                            textStyle="text/sm"
                            aria-label={`Remove ${holding.ticker} holding`}
                            variant="ghost"
                            color="status.error.fg"
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

        <Divider borderColor="border.subtle" />

        {/* Add Holding */}
        <Box w="100%">
          <Text as="h2" textStyle="text/md" fontWeight="medium" mb={4}>
            Add holding
          </Text>
          <Stack direction={{ base: 'column', md: 'row' }} spacing={3} align={{ base: 'stretch', md: 'flex-end' }}>
            <FormControl flex={1.2} minW={0}>
              <FormLabel fontWeight="medium" textStyle="text/sm" color="text.secondary">
                ETF
              </FormLabel>
              <Select
                fontFamily="body"
                size="md"
                borderRadius="control"
                textStyle="text/sm"
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
            <FormControl flex={0.8} minW={0}>
              <FormLabel fontWeight="medium" textStyle="text/sm" color="text.secondary">
                Shares
              </FormLabel>
              <Input
                fontFamily="body"
                size="md"
                textStyle="text/sm"
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
            <FormControl flex={0.8} minW={0}>
              <FormLabel fontWeight="medium" textStyle="text/sm" color="text.secondary">
                Date purchased (optional)
              </FormLabel>
              <DateStringInput
                fontFamily="body"
                size="md"
                textStyle="text/sm"
                value={newDatePurchased}
                onChange={(date) => {
                  setNewDatePurchased(date)
                }}
              />
            </FormControl>
            <Button
              size="md"
              flexShrink={0}
              onClick={() => {
                void handleAddHolding()
              }}
              isLoading={addHoldingMutation.isLoading}
              isDisabled={!newShares}
            >
              Add
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Box>
  )
}
