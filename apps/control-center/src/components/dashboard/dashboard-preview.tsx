import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { useBitcoinDisplay } from '../../hooks/use-bitcoin-display'
import { formatBitcoin } from '../../lib/bitcoin-display'
import { StatementsEmptyState } from '../statements/statements-empty-state'
import { BitcoinPriceChart } from './bitcoin-price-chart'
import { DashboardAmount, DashboardCardTitle } from './dashboard-typography'

export function DashboardPreview({
  loading = false,
  unavailable = false,
}: {
  loading?: boolean
  unavailable?: boolean
}): JSX.Element {
  const { unit } = useBitcoinDisplay()
  const zeroBalance = formatBitcoin(0, unit)

  return (
    <Stack gap={6}>
      <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" overflow="hidden">
        <Flex p={{ base: 5, md: 7 }} justify="space-between" align="start" gap={5} flexWrap="wrap">
          <Box>
            <DashboardCardTitle>Total Bitcoin</DashboardCardTitle>
            <Flex align="baseline" gap={2} mt={1} flexWrap="wrap">
              <DashboardAmount>{loading ? '—' : zeroBalance}</DashboardAmount>
            </Flex>
            <Text textStyle="text/md" color="neutral.600" mt={1}>
              {loading ? 'Loading your holdings…' : '$0.00 USD'}
            </Text>
          </Box>
        </Flex>
        <Grid templateColumns="repeat(3, minmax(0, 1fr))" borderTop="1px solid" borderColor="neutral.200">
          {[
            ['Accounts', '0'],
            ['30d Change', zeroBalance],
            ['Statements', '0'],
          ].map(([label, value]) => (
            <Box key={label} px={{ base: 4, md: 7 }} py={4}>
              <Text textStyle="text/xs" color="neutral.600" mb={1}>
                {label}
              </Text>
              <Text textStyle="text/md" fontWeight="medium" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {loading ? '—' : value}
              </Text>
            </Box>
          ))}
        </Grid>
      </Box>
      <BitcoinPriceChart />
      {!loading && !unavailable && (
        <Flex
          bg="neutral.50"
          borderRadius="panel"
          p={{ base: 5, md: 6 }}
          align={{ base: 'start', md: 'center' }}
          justify="space-between"
          direction={{ base: 'column', md: 'row' }}
          gap={5}
        >
          <Box maxW="lg">
            <Text as="h2" textStyle="text/xl" fontWeight="medium">
              Your Bitcoin, in one place
            </Text>
            <Text textStyle="text/sm" color="neutral.600" mt={2}>
              Add a wallet or exchange account to see your balances, follow your holdings over time, and create Bitcoin
              statements.
            </Text>
          </Box>
          <Button as={Link} to="/accounts/add" leftIcon={<Plus size={18} />} flexShrink={0}>
            Add Account
          </Button>
        </Flex>
      )}
      <Box>
        <Text as="h2" textStyle="text/xl" fontWeight="medium" mb={4}>
          Recent Statements
        </Text>
        <StatementsEmptyState />
      </Box>
    </Stack>
  )
}
