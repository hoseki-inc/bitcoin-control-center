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
  Textarea,
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

type ConnectedAccount = RouterOutput['portalProve']['exchange']['coinbase']['connect']

const coinbaseFormSchema = z.object({
  apiKey: z.string().min(1, 'API Key Name is required'),
  secretKey: z.string().min(1, 'Private Key is required'),
})

type CoinbaseFormData = z.infer<typeof coinbaseFormSchema>

type Step = 'form' | 'loading' | 'success'
type ConnectRouteState = { returnTo?: string; replaceAccountId?: string }

export function ConnectCoinbase(): JSX.Element {
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
  const connectMutation = trpc.portalProve.exchange.coinbase.connect.useMutation()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CoinbaseFormData>({
    resolver: zodResolver(coinbaseFormSchema),
    defaultValues: { apiKey: '', secretKey: '' },
  })

  async function onSubmit(data: CoinbaseFormData): Promise<void> {
    setStep('loading')
    try {
      const account = await connectMutation.mutateAsync({
        apiKey: data.apiKey,
        secretKey: data.secretKey,
        replaceAccountId,
      })
      setConnectedAccount(account)
      setStep('success')
      // Invalidate cached control center data so charts refresh with new exchange data
      void utils.portalProve.controlCenter.getData.invalidate()
      void utils.portalProve.exchange.list.invalidate()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Coinbase account'
      toast.error(message)
      setStep('form')
    }
  }

  if (step === 'loading') {
    return (
      <PageTransition>
        <Receipt title="Connecting to Coinbase..." state="loading" />
      </PageTransition>
    )
  }

  if (step === 'success' && connectedAccount) {
    return (
      <PageTransition>
        <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />
        <Receipt
          title={isReconnect ? 'Coinbase Reconnected!' : 'Coinbase Connected!'}
          state="success"
          onClose={() => navigate(successPath)}
          closeTitle={isReconnect ? 'Back to Account' : 'Go to My Holdings'}
          content={
            <VStack spacing={8}>
              <img src="/images/exchanges/coinbase.svg" alt="Coinbase" style={{ height: '64px' }} />
              <Text textStyle="text/2xl" color="neutral.900" textAlign="center">
                Your Coinbase account &ldquo;{connectedAccount.displayName}&rdquo; is now{' '}
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
            <img src="/images/exchanges/coinbase.svg" alt="Coinbase" style={{ height: '32px' }} />
            <Heading textStyle="text/2xl" fontWeight="bold" color="neutral.900">
              {isReconnect ? 'Reconnect Coinbase Account' : 'Connect Coinbase Account'}
            </Heading>
          </Flex>
          <Text textStyle="text/md" color="neutral.600">
            Enter your Coinbase CDP API credentials to import your Bitcoin balance. Only read-only access is required.
          </Text>

          {/* Form fields */}
          <Stack gap={4}>
            <FormControl isInvalid={!!errors.apiKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                API Key Name
              </FormLabel>
              <Input {...register('apiKey')} placeholder="e.g. organizations/abc123/apiKeys/xyz" />
              <FormErrorMessage>{errors.apiKey?.message}</FormErrorMessage>
            </FormControl>

            <FormControl isInvalid={!!errors.secretKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                Private Key (PEM format)
              </FormLabel>
              <Textarea
                {...register('secretKey')}
                placeholder="-----BEGIN EC PRIVATE KEY-----&#10;...&#10;-----END EC PRIVATE KEY-----"
                rows={6}
                fontFamily="mono"
                fontSize="sm"
              />
              <FormErrorMessage>{errors.secretKey?.message}</FormErrorMessage>
            </FormControl>
          </Stack>

          {/* Instructions */}
          <Box bg="neutral.50" borderRadius="md" p={4}>
            <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" mb={2}>
              How to create a Coinbase API key
            </Text>
            <Stack gap={2} as="ol" listStyleType="decimal" pl={4}>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Go to{' '}
                <Text
                  as="a"
                  href="https://www.coinbase.com/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="neutral.900"
                  textDecoration="underline"
                >
                  Coinbase API Settings
                </Text>
                , sign in, and click &ldquo;Create API Key&rdquo;. Give it a nickname like &ldquo;Bitcoin Control
                Center&rdquo;.
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Under Advanced, select &ldquo;ECDSA (Legacy SDKs)&rdquo;. Under Permissions, check only &ldquo;View
                (Read-Only)&rdquo;; leave Trade and Transfer unchecked.
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Click &ldquo;Create &amp; Download&rdquo;. Open the downloaded file and copy both the API Key Name and
                the entire PEM private key, then paste them above.
              </Text>
            </Stack>
          </Box>

          {/* Info box */}
          <Box border="1px solid" borderColor="neutral.200" borderRadius="md" p={4} bg="shades.0">
            <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" mb={1}>
              What is being accessed?
            </Text>
            <Text textStyle="text/sm" color="neutral.600">
              Only your Bitcoin balance is read. No trading or withdrawal permissions are required or granted.
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
