import {
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  Spinner,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  chakra,
} from '@chakra-ui/react'
import { getRecordValue } from '@hoseki/packages/lib'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { CheckCircleFilledIcon, StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { AccountDetailsSkeleton } from '../../../components/loading/page-skeletons'
import { parseStrikeCsv } from '../../../lib/strike-csv'
import { trpc } from '../../../trpc'
import { needsExchangeReconnect } from '../../../utils/exchange-connection-status'

const TX_TYPE_COLORS = {
  purchase: 'success.600',
  receive: 'success.600',
  send: 'error.600',
  sale: 'error.600',
} satisfies Record<string, string>

const TX_TYPE_LABELS = {
  purchase: 'Purchase',
  receive: 'Receive',
  send: 'Send',
  sale: 'Sale',
} satisfies Record<string, string>

export function StrikeAccountDetailsPage(): JSX.Element {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const listQuery = trpc.portalProve.exchange.strike.list.useQuery()
  const refreshMutation = trpc.portalProve.exchange.refreshBalance.useMutation()
  const deleteMutation = trpc.portalProve.exchange.delete.useMutation()
  const importMutation = trpc.portalProve.exchange.strike.importStatement.useMutation()
  const deleteMonthMutation = trpc.portalProve.exchange.strike.deleteStatementMonth.useMutation()

  const monthsQuery = trpc.portalProve.exchange.strike.listStatementMonths.useQuery(
    { accountId: accountId ?? '' },
    { enabled: accountId != null && accountId !== '' },
  )

  const txQuery = trpc.portalProve.exchange.strike.listStatementTransactions.useQuery(
    { accountId: accountId ?? '', statementMonth: selectedMonth ?? undefined },
    { enabled: accountId != null && accountId !== '' && selectedMonth != null && selectedMonth !== '' },
  )

  if (listQuery.isLoading) {
    return <AccountDetailsSkeleton />
  }

  const account = listQuery.data?.find((a) => a.id === accountId)

  if (!account) {
    return <ErrorBanner mt={8} mb={4} message="Strike account not found." />
  }

  const btcSats = account.balance != null && account.balance !== '' ? Number(account.balance) : 0
  const btcAmount = (btcSats / 100_000_000).toFixed(8)
  const needsReconnect = needsExchangeReconnect(account)
  const accountDisplayName = account.displayName

  function handleReconnect(): void {
    if (accountId == null || accountId === '') {
      return
    }
    void navigate('/accounts/verify/strike', {
      state: {
        returnTo: `/accounts/strike/${accountId}`,
        replaceAccountId: accountId,
        displayName: accountDisplayName,
      },
    })
  }

  async function handleRefresh(): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    setIsRefreshing(true)
    try {
      await refreshMutation.mutateAsync({ accountId })
      await utils.portalProve.exchange.strike.list.invalidate()
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
    if (accountId == null || accountId === '') {
      return
    }
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync({ accountId })
      await utils.portalProve.exchange.strike.list.invalidate()
      await utils.portalProve.exchange.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      void navigate('/accounts')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove account'
      toast.error(message)
      setIsDeleting(false)
    }
  }

  async function handleCsvFile(file: File): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload the CSV export, not the PDF.')
      return
    }

    setIsImporting(true)
    try {
      const text = await file.text()
      const parsed = parseStrikeCsv(text)
      if (parsed.isErr()) {
        toast.error(parsed.unwrapErr().message)
        return
      }
      const transactions = parsed.unwrap()

      if (transactions.length === 0) {
        toast.error('No Bitcoin transactions found. Upload a CSV exported from Strike.')
        return
      }

      const result = await importMutation.mutateAsync({ accountId, transactions })
      await monthsQuery.refetch()
      if (selectedMonth != null && selectedMonth !== '') {
        await txQuery.refetch()
      }

      toast.success(
        `Imported ${result.imported} transactions${result.skipped > 0 ? ` (${result.skipped} duplicates skipped)` : ''}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import statement'
      toast.error(message)
    } finally {
      setIsImporting(false)
    }
  }

  async function handleDeleteMonth(month: string): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    try {
      await deleteMonthMutation.mutateAsync({ accountId, statementMonth: month })
      await monthsQuery.refetch()
      if (selectedMonth === month) {
        setSelectedMonth(null)
      }
      toast.success(`Removed ${formatMonth(month)} statement`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete statement'
      toast.error(message)
    }
  }

  return (
    <Box py={6}>
      {/* Top bar */}
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
        {/* Account name + status row */}
        <Box>
          <Text textStyle="text/md" fontWeight="medium">
            {account.displayName}
          </Text>
          <HStack spacing={1}>
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

        {/* Floating logo + metadata */}
        <Stack align="center" justify="center" w="640px" mx="auto" mt={-4}>
          <Box
            mx="auto"
            pt={10}
            pb={6}
            sx={{
              animation: 'float 4s ease-in-out infinite',
              '@keyframes float': {
                '0%': { transform: 'translateY(0)' },
                '50%': { transform: 'translateY(-6px)' },
                '100%': { transform: 'translateY(0)' },
              },
            }}
          >
            <chakra.img
              src="/images/exchanges/strike-icon.svg"
              alt="Strike"
              h="100px"
              display="block"
              opacity={needsReconnect ? 0.55 : 1}
              filter={needsReconnect ? 'grayscale(1)' : 'drop-shadow(-4px 6px 10px rgba(0, 0, 0, 0.2))'}
            />
          </Box>

          <HStack spacing={4} mb={4} w="100%" alignItems="flex-start">
            {/* Amount */}
            <Box w={['100%', '50%', '25%']}>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Amount
              </Text>
              {account.balance === null ? (
                <Text textStyle="label/sm" color="neutral.400" fontWeight="medium">
                  —
                </Text>
              ) : (
                <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                  {btcAmount} BTC
                </Text>
              )}
            </Box>

            {/* Status */}
            <Box w={['100%', '50%', '25%']}>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Status
              </Text>
              {needsReconnect ? (
                <StatusBadge status="warning" label="Reconnect Required" w="fit-content" />
              ) : (
                <StatusBadge status="success" label="Connected" icon={CheckCircleFilledIcon} w="fit-content" />
              )}
            </Box>

            {/* Account Type */}
            <Box w={['100%', '50%', '25%']}>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Account Type
              </Text>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                Custodial
              </Text>
            </Box>

            {/* Date Added */}
            <Box w={['100%', '50%', '25%']} textAlign="right">
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Date Added
              </Text>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
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

        <hr />

        {/* Statement Import Section */}
        <Box maxW="640px" mx="auto" w="100%">
          <Heading textStyle="text/lg" fontWeight="semibold" mb={1}>
            Account Statements
          </Heading>
          <Text textStyle="text/xs" color="neutral.500" mb={4}>
            Import your Strike statements as CSV files to add transaction detail. Any data imported here will appear on
            your Bitcoin Control Center statements.
          </Text>

          {/* CSV Drop Zone */}
          <CsvDropZone
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            isImporting={isImporting}
            fileInputRef={fileInputRef}
            onFile={(file) => {
              void handleCsvFile(file)
            }}
          />

          {/* Imported Months */}
          {monthsQuery.data && monthsQuery.data.length > 0 && (
            <Box mt={6}>
              <Text textStyle="label/sm" fontWeight="semibold" mb={2}>
                Imported Statements
              </Text>
              <Stack spacing={2}>
                {monthsQuery.data.map((month) => (
                  <Flex
                    key={month}
                    align="center"
                    justify="space-between"
                    px={4}
                    py={2.5}
                    borderWidth="1px"
                    borderColor={selectedMonth === month ? 'neutral.900' : 'neutral.200'}
                    borderRadius="md"
                    cursor="pointer"
                    bg={selectedMonth === month ? 'neutral.50' : 'shades.0'}
                    _hover={{ borderColor: 'neutral.400' }}
                    transition="all 0.15s ease"
                  >
                    <Text
                      as="button"
                      type="button"
                      flex={1}
                      textAlign="left"
                      textStyle="text/sm"
                      fontWeight="medium"
                      aria-pressed={selectedMonth === month}
                      onClick={() => {
                        setSelectedMonth(selectedMonth === month ? null : month)
                      }}
                    >
                      {formatMonth(month)}
                    </Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      color="error.500"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeleteMonth(month)
                      }}
                    >
                      Remove
                    </Button>
                  </Flex>
                ))}
              </Stack>
            </Box>
          )}

          {/* Transaction Table */}
          {selectedMonth != null && selectedMonth !== '' && txQuery.data && txQuery.data.length > 0 && (
            <Box mt={4}>
              <Text textStyle="label/sm" fontWeight="semibold" mb={2}>
                {formatMonth(selectedMonth)} — {txQuery.data.length} transaction{txQuery.data.length !== 1 ? 's' : ''}
              </Text>
              <Box borderWidth="1px" borderColor="neutral.200" borderRadius="md" overflow="hidden">
                <Box overflowX="auto">
                  <Table size="sm">
                    <Thead>
                      <Tr>
                        <Th>Date</Th>
                        <Th>Type</Th>
                        <Th isNumeric>BTC</Th>
                        <Th isNumeric>USD</Th>
                        <Th isNumeric>Rate</Th>
                        <Th>Description</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {txQuery.data.map((tx) => (
                        <Tr key={tx.id}>
                          <Td>
                            <Text textStyle="text/xs" whiteSpace="nowrap">
                              {format(new Date(tx.transactedAt), 'MMM d, HH:mm')}
                            </Text>
                          </Td>
                          <Td>
                            <Text
                              textStyle="text/xs"
                              fontWeight="medium"
                              color={getRecordValue(TX_TYPE_COLORS, tx.type) ?? 'neutral.600'}
                            >
                              {getRecordValue(TX_TYPE_LABELS, tx.type) ?? tx.type}
                            </Text>
                          </Td>
                          <Td isNumeric>
                            <Text textStyle="text/xs" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatBtcAmount(tx.amountBtc)}
                            </Text>
                          </Td>
                          <Td isNumeric>
                            <Text textStyle="text/xs" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {tx.amountUsd != null && tx.amountUsd !== ''
                                ? `$${Math.abs(Number(tx.amountUsd)).toFixed(2)}`
                                : '—'}
                            </Text>
                          </Td>
                          <Td isNumeric>
                            <Text textStyle="text/xs" color="neutral.500">
                              {tx.exchangeRate != null && tx.exchangeRate !== ''
                                ? `$${Number(tx.exchangeRate).toLocaleString()}`
                                : '—'}
                            </Text>
                          </Td>
                          <Td>
                            <Text textStyle="text/xs" color="neutral.500" maxW="200px" isTruncated>
                              {(tx.description != null && tx.description !== '') ||
                              (tx.txHash != null && tx.txHash !== '')
                                ? truncateHash(tx.txHash)
                                : '—'}
                            </Text>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Box>
              </Box>
            </Box>
          )}

          {selectedMonth != null && selectedMonth !== '' && txQuery.isLoading && (
            <Spinner mt={4} display="block" mx="auto" />
          )}
        </Box>
      </Stack>
    </Box>
  )
}

function CsvDropZone({
  isDragging,
  setIsDragging,
  isImporting,
  fileInputRef,
  onFile,
}: {
  isDragging: boolean
  setIsDragging: (v: boolean) => void
  isImporting: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFile: (file: File) => void
}): JSX.Element {
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(true)
    },
    [setIsDragging],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
    },
    [setIsDragging],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) {
        onFile(file)
      }
    },
    [setIsDragging, onFile],
  )

  return (
    <>
      <Flex
        as="button"
        type="button"
        width="full"
        _focusVisible={{ boxShadow: 'outline' }}
        direction="column"
        align="center"
        justify="center"
        py={8}
        px={4}
        borderWidth="2px"
        borderStyle="dashed"
        borderColor={isDragging ? 'primary.400' : 'neutral.200'}
        borderRadius="lg"
        bg={isDragging ? 'primary.50' : 'neutral.25'}
        cursor="pointer"
        transition="all 0.15s ease"
        _hover={{ borderColor: 'neutral.400', bg: 'neutral.50' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Icon viewBox="0 0 24 24" boxSize="28px" color="neutral.400" mb={2}>
          <path
            d="M12 16V4m0 0l-4 4m4-4l4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Icon>
        {isImporting ? (
          <HStack as="span" spacing={2}>
            <Spinner as="span" size="sm" />
            <Text as="span" textStyle="text/sm" color="neutral.600">
              Importing...
            </Text>
          </HStack>
        ) : (
          <>
            <Text as="span" textStyle="text/sm" fontWeight="medium" color="neutral.700">
              Drop Strike CSV here or click to browse
            </Text>
            <Text as="span" textStyle="text/xs" color="neutral.400" mt={0.5}>
              In Strike, open Documents, pick a statement, then ⋯ → Export as CSV. CSV files only.
            </Text>
          </>
        )}
      </Flex>
      <chakra.input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        display="none"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            onFile(file)
          }
          e.target.value = ''
        }}
      />
    </>
  )
}

function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-')
  const date = new Date(Number(year), Number(month) - 1)
  return format(date, 'MMMM yyyy')
}

function formatBtcAmount(amount: string): string {
  const num = Number(amount)
  return num >= 0 ? `+${num.toFixed(8)}` : num.toFixed(8)
}

function truncateHash(hash: string | null): string {
  if (hash == null || hash === '') {
    return ''
  }
  if (hash.length <= 16) {
    return hash
  }
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`
}
