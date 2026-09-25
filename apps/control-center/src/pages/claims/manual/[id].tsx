import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormLabel,
  HStack,
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
import { getRecordValue } from '@hoseki/packages/lib'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { DateStringInput } from '@hoseki/packages/ui/design-system/forms/date-string-input'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../../components/bitcoin-amount'
import { trpc } from '../../../trpc'

const TX_TYPE_LABELS = {
  buy: 'Buy',
  sell: 'Sell',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
} satisfies Record<string, string>

export function ManualAccountDetailsPage(): JSX.Element {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const [isDeleting, setIsDeleting] = useState(false)
  const [removal, setRemoval] = useState<{ kind: 'account' } | { kind: 'transaction'; id: string } | null>(null)
  const cancelRemovalRef = useRef<HTMLButtonElement>(null)

  // ─── Balance update form ────────────────────────────────────────
  const [newBtcAmount, setNewBtcAmount] = useState('')
  const [newBalanceDate, setNewBalanceDate] = useState(() => new Date().toISOString().slice(0, 10))

  // ─── Transaction form ───────────────────────────────────────────
  const [txType, setTxType] = useState<'buy' | 'sell' | 'transfer_in' | 'transfer_out'>('buy')
  const [txAmount, setTxAmount] = useState('')
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [txNote, setTxNote] = useState('')
  const [txAddToBalance, setTxAddToBalance] = useState(false)

  // ─── Queries ────────────────────────────────────────────────────
  const accountQuery = trpc.portalProve.manual.get.useQuery(
    { accountId: accountId ?? '' },
    { enabled: accountId != null && accountId !== '' },
  )
  const txQuery = trpc.portalProve.manual.transactions.list.useQuery(
    { accountId: accountId ?? '' },
    { enabled: accountId != null && accountId !== '' },
  )

  // ─── Mutations ──────────────────────────────────────────────────
  const updateBalanceMutation = trpc.portalProve.manual.updateBalance.useMutation()
  const addTxMutation = trpc.portalProve.manual.transactions.add.useMutation()
  const deleteTxMutation = trpc.portalProve.manual.transactions.delete.useMutation()
  const deleteMutation = trpc.portalProve.manual.delete.useMutation()

  if (accountQuery.isLoading) {
    return <Spinner mt={12} display="block" mx="auto" size="xl" />
  }

  const account = accountQuery.data
  if (!account) {
    return <ErrorBanner mt={8} mb={4} message="Manual account not found." />
  }

  const btcSats = account.balance ? Number(account.balance) : 0
  const btcAmount = (btcSats / 100_000_000).toFixed(8)

  async function invalidateAll(): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    await utils.portalProve.manual.get.invalidate({ accountId })
    await utils.portalProve.manual.list.invalidate()
    await utils.portalProve.manual.transactions.list.invalidate({ accountId })
    await utils.portalProve.controlCenter.invalidate()
  }

  async function handleUpdateBalance(): Promise<void> {
    if (accountId == null || accountId === '' || !newBtcAmount) {
      return
    }
    const balanceSats = Math.round(Number(newBtcAmount) * 1e8).toString()
    try {
      await updateBalanceMutation.mutateAsync({
        accountId,
        balanceSats,
        balanceAsOf: new Date(newBalanceDate + 'T12:00:00').toISOString(),
      })
      await invalidateAll()
      setNewBtcAmount('')
      toast.success('Balance updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update balance')
    }
  }

  async function handleAddTransaction(): Promise<void> {
    if (accountId == null || accountId === '' || !txAmount) {
      return
    }
    const amountSats = Math.round(Number(txAmount) * 1e8).toString()
    try {
      await addTxMutation.mutateAsync({
        accountId,
        type: txType,
        amountSats,
        transactedAt: new Date(txDate + 'T12:00:00').toISOString(),
        note: txNote || undefined,
        addToBalance: txAddToBalance,
      })

      await invalidateAll()
      setTxAmount('')
      setTxNote('')
      toast.success('Transaction added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add transaction')
    }
  }

  async function handleDeleteTransaction(transactionId: string): Promise<void> {
    try {
      await deleteTxMutation.mutateAsync({ transactionId })
      await invalidateAll()
      toast.success('Transaction deleted')
      setRemoval(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete transaction')
    }
  }

  async function handleDelete(): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync({ accountId })
      await utils.portalProve.manual.list.invalidate()
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
        <TopBar.Item as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6}>
        {/* Account header */}
        <Box>
          <HStack spacing={3} mb={1}>
            <ManualIcon />
            <PageHeading title={account.displayName} />
          </HStack>
          <HStack spacing={1} flexWrap="wrap">
            <Box w={2} h={2} bg="neutral.400" borderRadius="full" />
            <Text textStyle="text/sm" color="neutral.600" fontWeight="medium">
              Manually tracked
            </Text>
            {account.createdAt && (
              <>
                <Text textStyle="text/sm" color="neutral.400">
                  ·
                </Text>
                <Text textStyle="text/sm" color="neutral.600">
                  {format(new Date(account.createdAt), 'MMMM do, yyyy')}
                </Text>
              </>
            )}
          </HStack>
        </Box>

        <Divider borderColor="neutral.200" />

        <Stack direction={{ base: 'column', sm: 'row' }} spacing={6} justify="space-between">
          <Box>
            <Text textStyle="text/sm" color="neutral.600" mb={1}>
              Balance
            </Text>
            <Text textStyle="text/xl" fontWeight="medium" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              <>
                <BitcoinAmount btc={btcAmount} />
              </>
            </Text>
          </Box>
          {account.balanceAsOf != null && account.balanceAsOf !== '' && (
            <Box>
              <Text textStyle="text/sm" color="neutral.600" mb={1}>
                Balance as of
              </Text>
              <Text textStyle="text/sm" color="neutral.900">
                {format(new Date(account.balanceAsOf), 'MMMM do, yyyy')}
              </Text>
            </Box>
          )}
        </Stack>
        <Divider borderColor="neutral.200" />

        {/* Update Balance */}
        <Box w="100%">
          <Text as="h2" textStyle="text/md" fontWeight="medium" mb={4}>
            Update balance
          </Text>
          <Stack direction={{ base: 'column', md: 'row' }} spacing={3} align={{ base: 'stretch', md: 'flex-end' }}>
            <FormControl flex={1} minW={0}>
              <FormLabel fontWeight="medium" textStyle="text/sm" color="neutral.600">
                New Balance (BTC)
              </FormLabel>
              <Input
                fontFamily="body"
                size="md"
                textStyle="text/sm"
                type="number"
                step="any"
                min="0"
                placeholder="0.00000000"
                value={newBtcAmount}
                onChange={(e) => {
                  setNewBtcAmount(e.target.value)
                }}
              />
            </FormControl>
            <FormControl flex={1} minW={0}>
              <FormLabel fontWeight="medium" textStyle="text/sm" color="neutral.600">
                As of Date
              </FormLabel>
              <DateStringInput
                isRequired
                fontFamily="body"
                size="md"
                textStyle="text/sm"
                value={newBalanceDate}
                onChange={(date) => {
                  setNewBalanceDate(date)
                }}
              />
            </FormControl>
            <Button
              size="md"
              variant="outline"
              onClick={() => {
                void handleUpdateBalance()
              }}
              isLoading={updateBalanceMutation.isLoading}
              isDisabled={!newBtcAmount}
            >
              Update
            </Button>
          </Stack>
        </Box>

        <Divider borderColor="neutral.200" />

        {/* Add Transaction */}
        <Box w="100%">
          <Text as="h2" textStyle="text/md" fontWeight="medium" mb={4}>
            Add transaction
          </Text>
          <Stack spacing={3}>
            <Stack direction={{ base: 'column', md: 'row' }} spacing={3}>
              <FormControl flex={1} minW={0}>
                <FormLabel fontWeight="medium" textStyle="text/sm" color="neutral.600">
                  Type
                </FormLabel>
                <Select
                  fontFamily="body"
                  size="md"
                  borderRadius="control"
                  textStyle="text/sm"
                  value={txType}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === 'buy' || value === 'sell' || value === 'transfer_in' || value === 'transfer_out') {
                      setTxType(value)
                    }
                  }}
                >
                  <option value="buy">Buy</option>
                  <option value="transfer_in">Transfer In</option>
                  <option value="sell">Sell</option>
                  <option value="transfer_out">Transfer Out</option>
                </Select>
              </FormControl>
              <FormControl flex={1} minW={0}>
                <FormLabel fontWeight="medium" textStyle="text/sm" color="neutral.600">
                  Amount (BTC)
                </FormLabel>
                <Input
                  fontFamily="body"
                  size="md"
                  textStyle="text/sm"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00000000"
                  value={txAmount}
                  onChange={(e) => {
                    setTxAmount(e.target.value)
                  }}
                />
              </FormControl>
              <FormControl flex={1} minW={0}>
                <FormLabel fontWeight="medium" textStyle="text/sm" color="neutral.600">
                  Date
                </FormLabel>
                <DateStringInput
                  isRequired
                  fontFamily="body"
                  size="md"
                  textStyle="text/sm"
                  value={txDate}
                  onChange={(date) => {
                    setTxDate(date)
                  }}
                />
              </FormControl>
            </Stack>
            <Stack direction={{ base: 'column', md: 'row' }} spacing={3} align={{ base: 'stretch', md: 'flex-end' }}>
              <FormControl flex={1} minW={0}>
                <FormLabel fontWeight="medium" textStyle="text/sm" color="neutral.600">
                  Note (optional)
                </FormLabel>
                <Input
                  fontFamily="body"
                  size="md"
                  textStyle="text/sm"
                  placeholder="Optional note"
                  value={txNote}
                  onChange={(e) => {
                    setTxNote(e.target.value)
                  }}
                />
              </FormControl>
              <Button
                size="md"
                variant="outline"
                onClick={() => {
                  void handleAddTransaction()
                }}
                isLoading={addTxMutation.isLoading}
                isDisabled={!txAmount}
              >
                Add
              </Button>
            </Stack>
            <Checkbox
              size="sm"
              isChecked={txAddToBalance}
              onChange={(e) => {
                setTxAddToBalance(e.target.checked)
              }}
              colorScheme="orange"
            >
              <Text textStyle="text/sm" color="neutral.600">
                Add this amount to balance
              </Text>
            </Checkbox>
          </Stack>
        </Box>

        {/* Transaction History */}
        {txQuery.data && txQuery.data.length > 0 && (
          <Box w="100%">
            <Text as="h2" textStyle="text/md" fontWeight="medium" mb={4}>
              Transactions
            </Text>
            <Box borderWidth="1px" borderColor="neutral.200" borderRadius="panel" overflowX="auto">
              <Table
                size="sm"
                sx={{ th: { textTransform: 'none', letterSpacing: 'normal' }, td: { whiteSpace: 'nowrap' } }}
              >
                <Thead>
                  <Tr>
                    <Th textStyle="text/sm" fontFamily="body" color="neutral.600">
                      Type
                    </Th>
                    <Th textStyle="text/sm" fontFamily="body" color="neutral.600">
                      Amount
                    </Th>
                    <Th textStyle="text/sm" fontFamily="body" color="neutral.600">
                      Date
                    </Th>
                    <Th textStyle="text/sm" fontFamily="body" color="neutral.600">
                      Note
                    </Th>
                    <Th textStyle="text/sm" fontFamily="body" color="neutral.600" aria-label="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {txQuery.data.map((tx) => (
                    <Tr key={tx.id}>
                      <Td>
                        <Text
                          textStyle="text/sm"
                          fontWeight="medium"
                          color={tx.type === 'buy' || tx.type === 'transfer_in' ? 'success.600' : 'error.600'}
                        >
                          {getRecordValue(TX_TYPE_LABELS, tx.type) ?? tx.type}
                        </Text>
                      </Td>
                      <Td>
                        <>
                          <Text textStyle="text/sm">
                            <BitcoinAmount btc={Number(tx.amountSats) / 1e8} />
                          </Text>
                        </>
                      </Td>
                      <Td>
                        <Text textStyle="text/sm">{format(new Date(tx.transactedAt), 'MMM d, yyyy')}</Text>
                      </Td>
                      <Td>
                        <Text textStyle="text/sm" color="neutral.600">
                          {(tx.note?.length ?? 0) > 0 ? tx.note : '—'}
                        </Text>
                      </Td>
                      <Td>
                        <Button
                          size="xs"
                          variant="ghost"
                          color="error.500"
                          onClick={() => {
                            setRemoval({ kind: 'transaction', id: tx.id })
                          }}
                        >
                          Delete
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </Box>
        )}
      </Stack>
      <Box mt={8} pt={5} borderTop="1px solid" borderColor="neutral.200">
        <Button
          variant="ghost"
          color="error.700"
          onClick={() => {
            setRemoval({ kind: 'account' })
          }}
        >
          Remove Account
        </Button>
      </Box>
      <AlertDialog
        isOpen={removal !== null}
        leastDestructiveRef={cancelRemovalRef}
        onClose={() => {
          if (!isDeleting && !deleteTxMutation.isLoading) {
            setRemoval(null)
          }
        }}
        closeOnOverlayClick={!isDeleting && !deleteTxMutation.isLoading}
        closeOnEsc={!isDeleting && !deleteTxMutation.isLoading}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent mx={4} borderRadius="dialog">
            <AlertDialogHeader textStyle="text/xl">
              {removal?.kind === 'account' ? 'Remove account?' : 'Remove transaction?'}
            </AlertDialogHeader>
            <AlertDialogBody textStyle="text/md">
              {removal?.kind === 'account'
                ? `This removes “${account.displayName}” and its manually recorded history from Control Center. Your Bitcoin is not moved. This cannot be undone.`
                : 'This removes the selected transaction from your local records. This cannot be undone.'}
            </AlertDialogBody>
            <AlertDialogFooter gap={3}>
              <Button
                ref={cancelRemovalRef}
                variant="outline"
                onClick={() => {
                  setRemoval(null)
                }}
                isDisabled={isDeleting || deleteTxMutation.isLoading}
              >
                Cancel
              </Button>
              <Button
                variant="error"
                isLoading={isDeleting || deleteTxMutation.isLoading}
                onClick={() => {
                  if (removal?.kind === 'account') {
                    void handleDelete()
                  } else if (removal) {
                    void handleDeleteTransaction(removal.id)
                  }
                }}
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
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
