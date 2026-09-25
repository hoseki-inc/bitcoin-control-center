import {
  Box,
  Button,
  CloseButton,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Select,
  Stack,
  Text,
} from '@chakra-ui/react'
import { ETF_CONFIGS, ETF_TICKERS, type EtfTicker, computeHoldingBtcSats } from '@hoseki/packages/etfs/holdings'
import { DateStringInput } from '@hoseki/packages/ui/design-system/forms/date-string-input'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { BitcoinAmount } from '../../../components/bitcoin-amount'
import { SensitiveValue } from '../../../components/sensitive-value'
import { parseNavigationState } from '../../../lib/navigation-state'
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
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'

  const [displayName, setDisplayName] = useState('')
  const [holdings, setHoldings] = useState<HoldingRow[]>([createEmptyRow()])

  const createMutation = trpc.portalProve.etf.create.useMutation()
  const utils = trpc.useUtils()

  function addRow(): void {
    setHoldings((prev) => [...prev, createEmptyRow()])
  }

  function removeRow(key: number): void {
    setHoldings((prev) => {
      if (prev.length <= 1) {
        return prev
      }
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
    if (isNaN(shares) || shares <= 0) {
      continue
    }
    const config = ETF_CONFIGS[row.ticker]
    totalBtcSats += computeHoldingBtcSats(config, shares, asOf)
  }
  const totalBtc = Number(totalBtcSats) / 1e8

  const hasValidHoldings = holdings.some((r) => {
    const shares = parseFloat(r.shares)
    return !isNaN(shares) && shares > 0
  })
  const isValid = displayName.trim().length > 0 && hasValidHoldings

  async function handleSubmit(): Promise<void> {
    if (!isValid) {
      return
    }

    try {
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

      const result = await createMutation.mutateAsync({
        displayName: displayName.trim(),
        holdings: validHoldings,
      })

      await utils.portalProve.etf.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      toast.success('ETF account created')
      void navigate(`/accounts/etf/${result.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create ETF account'
      toast.error(message)
    }
  }

  return (
    <Box py={{ base: 6, md: 8 }} maxW="640px" mx="auto" w="full">
      <TopBar mb={8}>
        <TopBar.Item as={Link} to={returnTo}>
          Back
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6}>
        <PageHeading
          title="Add Bitcoin ETF Holdings"
          description="Track your indirect Bitcoin exposure through ETF shares."
        />

        <FormControl>
          <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
            Display name
          </FormLabel>
          <Input
            fontFamily="body"
            placeholder="e.g. My ETF Portfolio, Brokerage Account"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
            }}
          />
        </FormControl>

        <Box>
          <Text as="h2" textStyle="text/md" color="neutral.600" fontWeight="semibold" mb={3}>
            Holdings
          </Text>
          <Stack spacing={3}>
            {holdings.map((row) => (
              <Grid
                key={row.key}
                templateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(0, 1.5fr) minmax(0, 0.8fr) minmax(0, 1fr)' }}
                gap={4}
                alignItems="end"
                p={4}
                bg="neutral.50"
                borderRadius="panel"
              >
                <FormControl minW={0}>
                  <FormLabel textStyle="text/sm" color="neutral.600">
                    ETF
                  </FormLabel>
                  <Select
                    fontFamily="body"
                    size="md"
                    borderRadius="control"
                    bg="shades.0"
                    textStyle="text/sm"
                    value={row.ticker}
                    onChange={(e) => {
                      updateRow(row.key, 'ticker', e.target.value)
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
                <FormControl minW={0}>
                  <FormLabel textStyle="text/sm" color="neutral.600">
                    Shares
                  </FormLabel>
                  <Input
                    fontFamily="body"
                    size="md"
                    bg="shades.0"
                    textStyle="text/sm"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0"
                    value={row.shares}
                    onChange={(e) => {
                      updateRow(row.key, 'shares', e.target.value)
                    }}
                  />
                </FormControl>
                <FormControl minW={0}>
                  <FormLabel textStyle="text/sm" color="neutral.600">
                    Date purchased (optional)
                  </FormLabel>
                  <DateStringInput
                    fontFamily="body"
                    size="md"
                    bg="shades.0"
                    textStyle="text/sm"
                    value={row.datePurchased}
                    onChange={(date) => {
                      updateRow(row.key, 'datePurchased', date)
                    }}
                  />
                </FormControl>
                {holdings.length > 1 && (
                  <CloseButton
                    size="md"
                    aria-label={`Remove ${row.ticker} holding`}
                    justifySelf="end"
                    gridColumn={{ md: '1 / -1' }}
                    onClick={() => {
                      removeRow(row.key)
                    }}
                  />
                )}
              </Grid>
            ))}
          </Stack>
          <Button size="sm" variant="ghost" mt={3} onClick={addRow}>
            Add another ETF
          </Button>
        </Box>

        {/* Live BTC total */}
        {totalBtcSats > 0n && (
          <Box bg="neutral.50" p={4} borderRadius="panel">
            <Text textStyle="text/xs" color="neutral.600" fontWeight="medium" mb={1}>
              Estimated Bitcoin total
            </Text>
            <Text fontFamily="mono" textStyle="text/lg" fontWeight="bold" color="neutral.900">
              <SensitiveValue>
                <BitcoinAmount btc={totalBtc.toFixed(8)} />
              </SensitiveValue>
            </Text>
          </Box>
        )}

        <Flex justify="flex-end" pt={2}>
          <Button
            onClick={() => {
              void handleSubmit()
            }}
            isLoading={createMutation.isLoading}
            isDisabled={!isValid}
          >
            Add ETF Holdings
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
