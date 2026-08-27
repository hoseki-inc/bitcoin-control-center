import {
  Box,
  Button,
  CloseButton,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Select,
  Stack,
  Text,
} from '@chakra-ui/react'
import { ETF_CONFIGS, ETF_TICKERS, type EtfTicker, computeHoldingBtcSats } from '@hoseki/packages/etfs/holdings'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { trpc } from '../../../trpc'

interface HoldingRow {
  key: number
  ticker: EtfTicker
  shares: string
  datePurchased: string
}

let nextKey = 1

function createEmptyRow(): HoldingRow {
  return { key: nextKey++, ticker: 'IBIT', shares: '', datePurchased: '' }
}

export function ClaimsVerifyEtfPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/accounts'

  const [displayName, setDisplayName] = useState('')
  const [holdings, setHoldings] = useState<HoldingRow[]>([createEmptyRow()])

  const createMutation = trpc.portalProve.etf.create.useMutation()
  const utils = trpc.useUtils()

  function addRow(): void {
    setHoldings((prev) => [...prev, createEmptyRow()])
  }

  function removeRow(key: number): void {
    setHoldings((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((r) => r.key !== key)
    })
  }

  function updateRow(key: number, field: keyof HoldingRow, value: string): void {
    setHoldings((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  }

  // Compute live BTC total
  const asOf = new Date()
  let totalBtcSats = 0n
  for (const row of holdings) {
    const shares = parseFloat(row.shares)
    if (isNaN(shares) || shares <= 0) continue
    const config = ETF_CONFIGS[row.ticker]
    if (config) {
      totalBtcSats += computeHoldingBtcSats(config, shares, asOf)
    }
  }
  const totalBtc = Number(totalBtcSats) / 1e8

  const hasValidHoldings = holdings.some((r) => {
    const shares = parseFloat(r.shares)
    return !isNaN(shares) && shares > 0
  })
  const isValid = displayName.trim().length > 0 && hasValidHoldings

  async function handleSubmit(): Promise<void> {
    if (!isValid) return

    const validHoldings = holdings
      .filter((r) => {
        const shares = parseFloat(r.shares)
        return !isNaN(shares) && shares > 0
      })
      .map((r) => ({
        ticker: r.ticker,
        shares: r.shares,
        datePurchased: r.datePurchased ? new Date(r.datePurchased + 'T12:00:00').toISOString() : undefined,
      }))

    try {
      const result = await createMutation.mutateAsync({
        displayName: displayName.trim(),
        holdings: validHoldings,
      })

      await utils.portalProve.etf.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      toast.success('ETF account created')
      navigate(`/accounts/etf/${result.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create ETF account'
      toast.error(message)
    }
  }

  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to={returnTo}>
          Back
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6} maxW="560px" mx="auto">
        <Box>
          <Heading textStyle="text/2xl" fontWeight="bold" color="neutral.900" mb={2}>
            Add Bitcoin ETF Holdings
          </Heading>
          <Text textStyle="text/md" color="neutral.400">
            Track your indirect Bitcoin exposure through ETF shares.
          </Text>
        </Box>

        <FormControl>
          <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
            Display Name
          </FormLabel>
          <Input
            placeholder="e.g. My ETF Portfolio, Brokerage Account"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormControl>

        <Box>
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={3}>
            Holdings
          </Text>
          <Stack spacing={3}>
            {holdings.map((row) => (
              <HStack key={row.key} spacing={2} align="flex-end">
                <FormControl flex={1.2}>
                  <FormLabel textStyle="text/xs" color="neutral.400">
                    ETF
                  </FormLabel>
                  <Select size="sm" value={row.ticker} onChange={(e) => updateRow(row.key, 'ticker', e.target.value)}>
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
                  <FormLabel textStyle="text/xs" color="neutral.400">
                    Shares
                  </FormLabel>
                  <Input
                    size="sm"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0"
                    value={row.shares}
                    onChange={(e) => updateRow(row.key, 'shares', e.target.value)}
                  />
                </FormControl>
                <FormControl flex={0.8}>
                  <FormLabel textStyle="text/xs" color="neutral.400">
                    Date Purchased
                  </FormLabel>
                  <Input
                    size="sm"
                    type="date"
                    value={row.datePurchased}
                    onChange={(e) => updateRow(row.key, 'datePurchased', e.target.value)}
                  />
                </FormControl>
                {holdings.length > 1 && <CloseButton size="sm" onClick={() => removeRow(row.key)} />}
              </HStack>
            ))}
          </Stack>
          <Button size="sm" variant="ghost" mt={2} onClick={addRow}>
            + Add Another ETF
          </Button>
        </Box>

        {/* Live BTC total */}
        {totalBtcSats > 0n && (
          <Box bg="neutral.50" p={4} borderRadius="md">
            <Text textStyle="text/xs" color="neutral.400" fontWeight="medium" mb={1}>
              Estimated BTC Total
            </Text>
            <Text fontFamily="mono" textStyle="text/lg" fontWeight="bold" color="neutral.900">
              {totalBtc.toFixed(8)} BTC
            </Text>
          </Box>
        )}

        <Flex justify="flex-end">
          <Button colorScheme="blue" onClick={handleSubmit} isLoading={createMutation.isLoading} isDisabled={!isValid}>
            Add ETF Holdings
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
