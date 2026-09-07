import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { PortfolioDemo } from './portfolio-demo'

export const ONBOARDING_KEY = 'onboarding_v1'

export function GettingStarted(): JSX.Element {
  const navigate = useNavigate()
  const setting = useLocalSetting(ONBOARDING_KEY)
  const [error, setError] = useState(false)

  const continueTo = async (state: string, path: string): Promise<void> => {
    setError(false)
    try {
      await setting.saveAsync(state)
      navigate(path)
    } catch {
      setError(true)
    }
  }

  return (
    <Stack as="section" py={{ base: 6, md: 12 }} gap={{ base: 6, md: 10 }}>
      <Box>
        <Text as="h1" textStyle="text/2xl" fontWeight="medium">
          See your Bitcoin over time.
        </Text>
        <Text textStyle="text/md" color="neutral.600" mt={2}>
          Track your balance, what you’ve added, and what you’ve withdrawn. Try a sample portfolio below.
        </Text>
      </Box>
      <PortfolioDemo />
      <Flex
        direction={{ base: 'column', md: 'row' }}
        justify="space-between"
        align={{ base: 'stretch', md: 'center' }}
        gap={5}
        pt={6}
      >
        <Box>
          <Text textStyle="text/lg" fontWeight="medium">
            Start with one account.
          </Text>
          <Text textStyle="text/sm" color="neutral.600" mt={1}>
            Connect a wallet or exchange, or enter holdings yourself.
          </Text>
        </Box>
        <Stack gap={3}>
          <Flex gap={3} direction={{ base: 'column', sm: 'row' }}>
            <Button isDisabled={setting.isSaving} onClick={() => void continueTo('started', '/accounts/add')}>
              Add First Account
            </Button>
            <Button variant="ghost" isDisabled={setting.isSaving} onClick={() => void continueTo('dismissed', '/home')}>
              Explore First
            </Button>
          </Flex>
          {error && (
            <Text role="alert" textStyle="text/sm" color="error.700">
              Could not save your progress. Try again.
            </Text>
          )}
        </Stack>
      </Flex>
      <Box as="details" color="neutral.600">
        <Box as="summary" cursor="pointer" py={3} textStyle="text/sm">
          How your data is handled
        </Box>
        <Text textStyle="text/sm" maxW="65ch" pb={2}>
          Connections use the internet to retrieve balances. Your history is stored on your own computer or server. Your
          private keys stay with you. Control Center can’t spend your Bitcoin.
        </Text>
      </Box>
    </Stack>
  )
}

export function FirstAccountReady({ ready }: { ready: boolean }): JSX.Element | null {
  const setting = useLocalSetting(ONBOARDING_KEY)
  const navigate = useNavigate()
  const [error, setError] = useState(false)
  if (setting.data !== 'started' || !ready) return null

  const finish = async (path: string): Promise<void> => {
    setError(false)
    try {
      await setting.saveAsync('completed')
      navigate(path)
    } catch {
      setError(true)
    }
  }

  return (
    <Stack as="section" gap={3} mb={8} pb={6} borderBottom="1px solid" borderColor="neutral.200">
      <Text as="h2" textStyle="text/xl" fontWeight="medium">
        Your account is ready
      </Text>
      <Text textStyle="text/md" color="neutral.600">
        Open your portfolio to see your balance and available history.
      </Text>
      <Flex gap={3} flexWrap="wrap">
        <Button isDisabled={setting.isSaving} onClick={() => void finish('/portfolio')}>
          View Portfolio
        </Button>
        <Button variant="outline" isDisabled={setting.isSaving} onClick={() => void finish('/accounts/add')}>
          Add Another Account
        </Button>
        <Button variant="ghost" isDisabled={setting.isSaving} onClick={() => void finish('/accounts')}>
          Dismiss
        </Button>
      </Flex>
      {error && (
        <Text role="alert" textStyle="text/sm" color="error.700">
          Could not save your progress. Try again.
        </Text>
      )}
    </Stack>
  )
}
