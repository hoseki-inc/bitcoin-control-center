import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import { ArrowRight, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { StatementsEmptyState } from '../statements/statements-empty-state'
import { BitcoinPriceChart } from './bitcoin-price-chart'

export function DashboardPreview({
  loading = false,
  unavailable = false,
}: {
  loading?: boolean
  unavailable?: boolean
}): JSX.Element {
  return (
    <Stack gap={6}>
      <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" overflow="hidden">
        <Flex p={{ base: 5, md: 7 }} justify="space-between" align="start" gap={5} flexWrap="wrap">
          <Box>
            <Text textStyle="text/sm" color="neutral.600" mb={2}>
              Total Bitcoin
            </Text>
            <Flex align="baseline" gap={2} flexWrap="wrap">
              <Text textStyle="text/3xl" fontFamily="mono" fontWeight="semibold" letterSpacing="-0.03em">
                {loading ? '—' : '0.00000000'}
              </Text>
              <Text textStyle="text/sm" color="neutral.600">
                BTC
              </Text>
            </Flex>
            <Text textStyle="text/md" color="neutral.600" mt={1}>
              {loading ? 'Loading your holdings…' : '$0.00 USD'}
            </Text>
          </Box>
        </Flex>
        <Grid templateColumns="repeat(3, minmax(0, 1fr))" borderTop="1px solid" borderColor="neutral.200">
          {[
            ['Accounts', '0'],
            ['30d Change', '0 BTC'],
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
        <Flex justify="space-between" align="center" gap={3} mb={4}>
          <Text as="h2" textStyle="text/xl" fontWeight="medium">
            Recent Statements
          </Text>
          <Button as={Link} to="/statements" variant="ghost" size="sm" rightIcon={<ArrowRight size={16} />}>
            View Statements
          </Button>
        </Flex>
        <StatementsEmptyState />
      </Box>
    </Stack>
  )
}
