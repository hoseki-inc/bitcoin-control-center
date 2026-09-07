import { Box, Flex, Stack, Text } from '@chakra-ui/react'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { Bitcoin, ChartNoAxesCombined, ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router'

export function ManualTypeSelectorPage(): JSX.Element {
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/accounts'

  return (
    <Box py={{ base: 6, md: 8 }} maxW="640px" mx="auto" w="full">
      <TopBar mb={8}>
        <TopBar.Item as={Link} to={returnTo}>
          Back
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6}>
        <PageHeading title="Manual Entry" description="Choose what type of holding you'd like to track." />

        <Stack spacing={4}>
          <TypeCard
            to="/accounts/verify/manual"
            state={location.state}
            title="Bitcoin Holdings"
            description="Track Bitcoin you hold directly in cold storage, paper wallets, or other self-custody wallets."
            icon={<Bitcoin size={20} aria-hidden="true" />}
          />
          <TypeCard
            to="/accounts/verify/etf"
            state={location.state}
            title="Bitcoin ETF Holdings"
            description="Track your Bitcoin exposure through ETFs like IBIT, FBTC, GBTC, and more."
            icon={<ChartNoAxesCombined size={20} aria-hidden="true" />}
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
      p={{ base: 4, md: 5 }}
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
      align="center"
      gap={4}
      cursor="pointer"
      _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' }}
      _hover={{ borderColor: 'neutral.400', bg: 'neutral.50' }}
    >
      <Flex
        w={10}
        h={10}
        borderRadius="control"
        bg="neutral.100"
        color="neutral.700"
        align="center"
        justify="center"
        flexShrink={0}
      >
        {props.icon}
      </Flex>
      <Box flex={1} minW={0}>
        <Text textStyle="text/md" fontWeight="semibold" color="neutral.900">
          {props.title}
        </Text>
        <Text textStyle="text/sm" color="neutral.600" mt={1}>
          {props.description}
        </Text>
      </Box>
      <ChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
    </Flex>
  )
}
