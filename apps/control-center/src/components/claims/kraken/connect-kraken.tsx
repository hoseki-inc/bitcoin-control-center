import {
  Box,
  Button,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  Heading,
  Input,
  Stack,
  Text,
  VStack,
} from '@chakra-ui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { PageTransition } from '@hoseki/packages/ui/design-system'
import { Receipt } from '@hoseki/packages/ui/prove-verify-ui'
import { ClaimConnectionWrapper, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { type RouterOutput, trpc } from '../../../trpc'

type ConnectedAccount = RouterOutput['portalProve']['exchange']['kraken']['connect']

const krakenFormSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  secretKey: z.string().min(1, 'Secret Key is required'),
})

type KrakenFormData = z.infer<typeof krakenFormSchema>

type Step = 'form' | 'loading' | 'success'
type ConnectRouteState = { returnTo?: string; replaceAccountId?: string }

export function ConnectKraken(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = location.state as ConnectRouteState | null
  const returnTo = routeState?.returnTo ?? '/accounts'
  const replaceAccountId = routeState?.replaceAccountId
  const isReconnect = Boolean(replaceAccountId)
  const successPath = isReconnect ? returnTo : '/accounts'
  const [step, setStep] = useState<Step>('form')
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null)

  const utils = trpc.useUtils()
  const connectMutation = trpc.portalProve.exchange.kraken.connect.useMutation()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<KrakenFormData>({
    resolver: zodResolver(krakenFormSchema),
    defaultValues: { apiKey: '', secretKey: '' },
  })

  async function onSubmit(data: KrakenFormData): Promise<void> {
    setStep('loading')
    try {
      const account = await connectMutation.mutateAsync({
        apiKey: data.apiKey,
        secretKey: data.secretKey,
        replaceAccountId,
      })
      setConnectedAccount(account)
      setStep('success')
      void utils.portalProve.controlCenter.getData.invalidate()
      void utils.portalProve.exchange.list.invalidate()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Kraken account'
      toast.error(message)
      setStep('form')
    }
  }

  if (step === 'loading') {
    return (
      <PageTransition>
        <Receipt title="Connecting to Kraken..." state="loading" />
      </PageTransition>
    )
  }

  if (step === 'success' && connectedAccount) {
    return (
      <PageTransition>
        <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />
        <Receipt
          title={isReconnect ? 'Kraken Reconnected!' : 'Kraken Connected!'}
          state="success"
          onClose={() => navigate(successPath)}
          closeTitle={isReconnect ? 'Back to Account' : 'Go to My Holdings'}
          content={
            <VStack spacing={8}>
              <img src="/images/exchanges/kraken.svg" alt="Kraken" style={{ height: '64px' }} />
              <Text textStyle="text/2xl" color="neutral.900" textAlign="center">
                Your Kraken account &ldquo;{connectedAccount.displayName}&rdquo; is now{' '}
                {isReconnect ? 'reconnected' : 'connected'}.
              </Text>
              <HStack spacing={4}>
                {!isReconnect && (
                  <Button variant="outline" onClick={() => navigate('/accounts/add')}>
                    Connect Another Account
                  </Button>
                )}
                <Button onClick={() => navigate(successPath)}>
                  {isReconnect ? 'Back to Account' : 'Go to My Holdings'}
                </Button>
              </HStack>
            </VStack>
          }
        />
      </PageTransition>
    )
  }

  return (
    <ClaimConnectionWrapper>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack gap={6} pt={8} pb={WizardFooter.padding}>
          {/* Header */}
          <Flex align="center" gap={3}>
            <img src="/images/exchanges/kraken.svg" alt="Kraken" style={{ height: '32px' }} />
            <Heading textStyle="text/2xl" fontWeight="bold" color="neutral.900">
              {isReconnect ? 'Reconnect Kraken Account' : 'Connect Kraken Account'}
            </Heading>
          </Flex>
          <Text textStyle="text/md" color="neutral.600">
            Enter your Kraken API credentials to import your Bitcoin balance. Only read-only access is required.
          </Text>

          {/* Form fields */}
          <Stack gap={4}>
            <FormControl isInvalid={!!errors.apiKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                API Key
              </FormLabel>
              <Input {...register('apiKey')} placeholder="Your Kraken API key" fontFamily="mono" fontSize="sm" />
              <FormErrorMessage>{errors.apiKey?.message}</FormErrorMessage>
            </FormControl>

            <FormControl isInvalid={!!errors.secretKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                Secret Key
              </FormLabel>
              <Input
                {...register('secretKey')}
                type="password"
                placeholder="Your Kraken secret key (base64)"
                fontFamily="mono"
                fontSize="sm"
              />
              <FormErrorMessage>{errors.secretKey?.message}</FormErrorMessage>
            </FormControl>
          </Stack>

          {/* Instructions */}
          <Box bg="neutral.50" borderRadius="md" p={4}>
            <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" mb={2}>
              How to create a Kraken API key
            </Text>
            <Stack gap={2} as="ol" listStyleType="decimal" pl={4}>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Go to{' '}
                <Text
                  as="a"
                  href="https://www.kraken.com/u/security/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="neutral.900"
                  textDecoration="underline"
                >
                  Kraken API Settings
                </Text>
                , sign in, and click &ldquo;Create API Key&rdquo;.
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Under Permissions, check &ldquo;Query Funds&rdquo; and &ldquo;Query Ledger Entries&rdquo;. Leave all
                other permissions unchecked.
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Click &ldquo;Generate Key&rdquo;. Copy both the API Key and the Private Key (base64 string), then paste
                them above.
              </Text>
            </Stack>
          </Box>

          {/* Info box */}
          <Box border="1px solid" borderColor="neutral.200" borderRadius="md" p={4} bg="shades.0">
            <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" mb={1}>
              What is being accessed?
            </Text>
            <Text textStyle="text/sm" color="neutral.600">
              Only your Bitcoin balance and transaction history are read. No trading or withdrawal permissions are
              required or granted.
            </Text>
          </Box>
        </Stack>

        <WizardFooter
          leftButton={
            <Button variant="outline" onClick={() => navigate(returnTo)}>
              Cancel
            </Button>
          }
          rightButton={<Button type="submit">{isReconnect ? 'Reconnect Account' : 'Connect Account'}</Button>}
        />
      </form>
    </ClaimConnectionWrapper>
  )
}
