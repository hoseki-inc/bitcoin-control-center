import { Box, Stack, Text } from '@chakra-ui/react'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { Link, useLocation } from 'react-router'
import { parseNavigationState } from '../../../lib/navigation-state'

export function ManualTypeSelectorPage(): JSX.Element {
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'

  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to={returnTo}>
          Back
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6} maxW="480px" mx="auto">
        <PageHeading title="Manual Entry" description="Choose what type of holding you'd like to track." />

        <Stack spacing={4}>
          <TypeCard
            to="/accounts/verify/manual"
            state={location.state}
            title="Bitcoin Holdings"
            description="Track BTC you hold directly — cold storage, paper wallets, or any self-custodied bitcoin."
          />
          <TypeCard
            to="/accounts/verify/etf"
            state={location.state}
            title="Bitcoin ETF Holdings"
            description="Track your Bitcoin exposure through ETFs like IBIT, FBTC, GBTC, and more."
          />
        </Stack>
      </Stack>
    </Box>
  )
}

function TypeCard(props: { to: string; state: unknown; title: string; description: string }): JSX.Element {
  return (
    <Box
      as={Link}
      display="block"
      to={props.to}
      state={props.state}
      p={5}
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="md"
      cursor="pointer"
      transition="all 0.15s ease"
      _hover={{ borderColor: 'neutral.400', bg: 'neutral.50' }}
    >
      <Text textStyle="text/md" fontWeight="semibold" color="neutral.900">
        {props.title}
      </Text>
      <Text textStyle="text/sm" color="neutral.600">
        {props.description}
      </Text>
    </Box>
  )
}
