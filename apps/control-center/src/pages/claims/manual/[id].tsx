import {
  Box,
  Button,
  Checkbox,
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
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { trpc } from '../../../trpc'

const TX_TYPE_LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
}

export function ManualAccountDetailsPage(): JSX.Element {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const [isDeleting, setIsDeleting] = useState(false)

  // ─── Balance update form ────────────────────────────────────────
  const [newBtcAmount, setNewBtcAmount] = useState('')
  const [newBalanceDate, setNewBalanceDate] = useState(() => new Date().toISOString().slice(0, 10))

  // ─── Transaction form ───────────────────────────────────────────
  const [txType, setTxType] = useState<string>('buy')
  const [txAmount, setTxAmount] = useState('')
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [txNote, setTxNote] = useState('')
  const [txAddToBalance, setTxAddToBalance] = useState(false)

  // ─── Queries ────────────────────────────────────────────────────
  const accountQuery = trpc.portalProve.manual.get.useQuery({ accountId: accountId ?? '' }, { enabled: !!accountId })
  const txQuery = trpc.portalProve.manual.transactions.list.useQuery(
    { accountId: accountId ?? '' },
    { enabled: !!accountId },
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
    if (!accountId) {
      return
    }
    await utils.portalProve.manual.get.invalidate({ accountId })
    await utils.portalProve.manual.list.invalidate()
    await utils.portalProve.manual.transactions.list.invalidate({ accountId })
    await utils.portalProve.controlCenter.invalidate()
  }

  async function handleUpdateBalance(): Promise<void> {
    if (!accountId || !newBtcAmount) {
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
    if (!accountId || !txAmount) {
      return
    }
    const amountSats = Math.round(Number(txAmount) * 1e8).toString()
    try {
      await addTxMutation.mutateAsync({
        accountId,
        type: txType as 'buy' | 'sell' | 'transfer_in' | 'transfer_out',
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete transaction')
    }
  }

  async function handleDelete(): Promise<void> {
    if (!accountId) {
      return
    }
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync({ accountId })
      await utils.portalProve.manual.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      navigate('/accounts')
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
        <TopBar.Item as="button" color="error.600" onClick={handleDelete}>
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
                Balance
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
            {account.balanceAsOf && (
              <Box w={['100%', '50%', '33%']} textAlign="right">
                <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                  Balance As Of
                </Text>
                <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                  {format(new Date(account.balanceAsOf), 'MMMM do, yyyy')}
                </Text>
              </Box>
            )}
          </HStack>
        </Stack>

        <hr />

        {/* Update Balance */}
        <Box maxW="640px" mx="auto" w="100%">
          <Heading textStyle="text/lg" fontWeight="semibold" mb={3}>
            Update Balance
          </Heading>
          <HStack spacing={3} align="flex-end">
            <FormControl flex={1}>
              <FormLabel textStyle="text/xs" color="neutral.600">
                New Balance (BTC)
              </FormLabel>
              <Input
                size="sm"
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
            <FormControl flex={1}>
              <FormLabel textStyle="text/xs" color="neutral.600">
                As of Date
              </FormLabel>
              <Input
                size="sm"
                type="date"
                value={newBalanceDate}
                onChange={(e) => {
                  setNewBalanceDate(e.target.value)
                }}
              />
            </FormControl>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUpdateBalance}
              isLoading={updateBalanceMutation.isLoading}
              isDisabled={!newBtcAmount}
            >
              Update
            </Button>
          </HStack>
        </Box>

        <hr />

        {/* Add Transaction */}
        <Box maxW="640px" mx="auto" w="100%">
          <Heading textStyle="text/lg" fontWeight="semibold" mb={3}>
            Add Transaction
          </Heading>
          <Stack spacing={3}>
            <HStack spacing={3}>
              <FormControl flex={1}>
                <FormLabel textStyle="text/xs" color="neutral.600">
                  Type
                </FormLabel>
                <Select
                  size="sm"
                  value={txType}
                  onChange={(e) => {
                    setTxType(e.target.value)
                  }}
                >
                  <option value="buy">Buy</option>
                  <option value="transfer_in">Transfer In</option>
                  <option value="sell">Sell</option>
                  <option value="transfer_out">Transfer Out</option>
                </Select>
              </FormControl>
              <FormControl flex={1}>
                <FormLabel textStyle="text/xs" color="neutral.600">
                  Amount (BTC)
                </FormLabel>
                <Input
                  size="sm"
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
              <FormControl flex={1}>
                <FormLabel textStyle="text/xs" color="neutral.600">
                  Date
                </FormLabel>
                <Input
                  size="sm"
                  type="date"
                  value={txDate}
                  onChange={(e) => {
                    setTxDate(e.target.value)
                  }}
                />
              </FormControl>
            </HStack>
            <HStack spacing={3} align="flex-end">
              <FormControl flex={1}>
                <FormLabel textStyle="text/xs" color="neutral.600">
                  Note (optional)
                </FormLabel>
                <Input
                  size="sm"
                  placeholder="Optional note"
                  value={txNote}
                  onChange={(e) => {
                    setTxNote(e.target.value)
                  }}
                />
              </FormControl>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddTransaction}
                isLoading={addTxMutation.isLoading}
                isDisabled={!txAmount}
              >
                Add
              </Button>
            </HStack>
            <Checkbox
              size="sm"
              isChecked={txAddToBalance}
              onChange={(e) => {
                setTxAddToBalance(e.target.checked)
              }}
              colorScheme="orange"
            >
              <Text textStyle="text/xs" color="neutral.600">
                Add this amount to balance
              </Text>
            </Checkbox>
          </Stack>
        </Box>

        {/* Transaction History */}
        {txQuery.data && txQuery.data.length > 0 && (
          <Box maxW="640px" mx="auto" w="100%">
            <Heading textStyle="text/lg" fontWeight="semibold" mb={3}>
              Transactions
            </Heading>
            <Box borderWidth="1px" borderColor="neutral.200" borderRadius="md" overflow="hidden">
              <Table size="sm">
                <Thead>
                  <Tr>
                    <Th>Type</Th>
                    <Th>Amount (BTC)</Th>
                    <Th>Date</Th>
                    <Th>Note</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {txQuery.data.map((tx) => (
                    <Tr key={tx.id}>
                      <Td>
                        <Text
                          textStyle="text/xs"
                          fontWeight="medium"
                          color={tx.type === 'buy' || tx.type === 'transfer_in' ? 'success.600' : 'error.600'}
                        >
                          {TX_TYPE_LABELS[tx.type] ?? tx.type}
                        </Text>
                      </Td>
                      <Td>
                        <Text textStyle="text/xs">{(Number(tx.amountSats) / 1e8).toFixed(8)}</Text>
                      </Td>
                      <Td>
                        <Text textStyle="text/xs">{format(new Date(tx.transactedAt), 'MMM d, yyyy')}</Text>
                      </Td>
                      <Td>
                        <Text textStyle="text/xs" color="neutral.500">
                          {tx.note || '—'}
                        </Text>
                      </Td>
                      <Td>
                        <Button
                          size="xs"
                          variant="ghost"
                          color="error.500"
                          onClick={() => handleDeleteTransaction(tx.id)}
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
