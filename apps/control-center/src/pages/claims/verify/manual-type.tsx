import { Box, Flex, Icon, Stack, Text } from '@chakra-ui/react'
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
            icon={<BitcoinIcon />}
          />
          <TypeCard
            to="/accounts/verify/etf"
            state={location.state}
            title="Bitcoin ETF Holdings"
            description="Track your Bitcoin exposure through ETFs like IBIT, FBTC, GBTC, and more."
            icon={<EtfIcon />}
          />
        </Stack>
      </Stack>
    </Box>
  )
}

function TypeCard(props: {
  to: string
  state: unknown
  title: string
  description: string
  icon: JSX.Element
}): JSX.Element {
  return (
    <Flex
      as={Link}
      to={props.to}
      state={props.state}
      p={5}
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="md"
      align="center"
      gap={4}
      cursor="pointer"
      transition="all 0.15s ease"
      _hover={{ borderColor: 'neutral.400', bg: 'neutral.50' }}
    >
      <Flex w={10} h={10} borderRadius="md" bg="neutral.50" align="center" justify="center" flexShrink={0}>
        {props.icon}
      </Flex>
      <Box>
        <Text textStyle="text/md" fontWeight="semibold" color="neutral.900">
          {props.title}
        </Text>
        <Text textStyle="text/sm" color="neutral.600">
          {props.description}
        </Text>
      </Box>
    </Flex>
  )
}

function BitcoinIcon(): JSX.Element {
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

function EtfIcon(): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" w={5} h={5} color="primary.500">
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </Icon>
  )
}
