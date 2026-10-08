import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import { formatBitcoin } from '../../lib/bitcoin-display'
import { FiatAmountText } from '../fiat-amount-text'
import { DashboardAmount } from './dashboard-typography'
import { StatMini } from './stat-mini'

export function DashboardPreview({
  loading = false,
  unavailable = false,
}: {
  loading?: boolean
  unavailable?: boolean
}): JSX.Element {
  const zeroBalance = formatBitcoin(0)
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
      {/* Styled like the loaded overview on Home: the same padding, amounts and stats. */}
      <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 5, md: 6 }} aria-busy={loading}>
        <DashboardAmount>{unresolved ? '—' : zeroBalance}</DashboardAmount>
        <FiatAmountText as="output" display="block" mt={1}>
          {loading ? 'Loading your holdings…' : unavailable ? 'Holdings unavailable' : '$0.00'}
        </FiatAmountText>
        <Grid
          templateColumns={{ base: '1fr', sm: '1fr 1fr' }}
          gap={6}
          mt={6}
          pt={5}
          borderTop="1px solid"
          borderColor="neutral.200"
        >
          <StatMini label="30d Change" value={unresolved ? null : new Decimal(0)} btcPrice={0} />
          <StatMini label="Accounts" count={unresolved ? null : 0} />
        </Grid>
      </Box>
    </Stack>
  )
}
