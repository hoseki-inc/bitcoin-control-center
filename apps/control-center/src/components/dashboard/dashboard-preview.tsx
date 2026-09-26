import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import { Link } from 'react-router'
import { useBitcoinDisplay } from '../../hooks/use-bitcoin-display'
import { formatBitcoin } from '../../lib/bitcoin-display'
import { FiatAmountText } from '../fiat-amount-text'
import { SensitiveValue } from '../sensitive-value'
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
  const unresolved = loading || unavailable

  return (
    <Stack gap={6}>
      {!unresolved && (
        <Flex
          direction={{ base: 'column', sm: 'row' }}
          align={{ base: 'start', sm: 'center' }}
          justify="space-between"
          gap={5}
        >
          <Box maxW="52ch">
            <Text as="h2" textStyle="text/xl" fontWeight="medium">
              Your Bitcoin, in one place
            </Text>
            <Text textStyle="text/md" color="neutral.600" mt={2}>
              Add your first wallet, exchange, or manually tracked holding.
              <br />
              Your wallets remain watch-only.
            </Text>
          </Box>
          <Button as={Link} to="/accounts/add" flexShrink={0}>
            Add Account
          </Button>
        </Flex>
      )}
      <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 5, md: 6 }} aria-busy={loading}>
        <DashboardCardTitle>Total Bitcoin</DashboardCardTitle>
        <Box mt={1}>
          <DashboardAmount primary>
            <SensitiveValue>{unresolved ? '—' : zeroBalance}</SensitiveValue>
          </DashboardAmount>
        </Box>
        <FiatAmountText as="output" display="block" primary mt={2}>
          <SensitiveValue>
            {loading ? 'Loading your holdings…' : unavailable ? 'Holdings unavailable' : '$0.00 USD'}
          </SensitiveValue>
        </FiatAmountText>
        <Grid
          templateColumns="repeat(2, minmax(0, 1fr))"
          gap={4}
          mt={6}
          pt={5}
          borderTop="1px solid"
          borderColor="neutral.200"
        >
          {[
            ['Accounts', '0'],
            ['30d Change', zeroBalance],
          ].map(([label, value]) => (
            <Box key={label} minW={0}>
              <Text textStyle="text/sm" color="neutral.600" mb={1}>
                {label}
              </Text>
              <Text textStyle="text/md" fontWeight="medium" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                <SensitiveValue>{unresolved ? '—' : value}</SensitiveValue>
              </Text>
            </Box>
          ))}
        </Grid>
      </Box>
    </Stack>
  )
}
