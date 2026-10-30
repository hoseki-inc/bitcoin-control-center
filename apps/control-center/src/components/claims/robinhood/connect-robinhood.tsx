import {
  Box,
  Button,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Heading,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ClaimConnectionWrapper, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { parseNavigationState } from '../../../lib/navigation-state'
import { type RouterOutput, trpc } from '../../../trpc'
import { ExchangeConnected, ExchangeConnecting } from '../exchange-connection'

type ConnectedAccount = RouterOutput['portalProve']['exchange']['robinhood']['connect']

const robinhoodFormSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  privateKey: z.string().min(1, 'Private Key is required'),
  displayName: z.string().min(1, 'Display name is required'),
})

type RobinhoodFormData = z.infer<typeof robinhoodFormSchema>

type Step = 'form' | 'loading' | 'success'

export function ConnectRobinhood(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = parseNavigationState(location.state)
  const returnTo = routeState?.returnTo ?? '/accounts'
  const replaceAccountId = routeState?.replaceAccountId
  const isReconnect = Boolean(replaceAccountId)
  const [step, setStep] = useState<Step>('form')
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null)

  const utils = trpc.useUtils()
  const connectMutation = trpc.portalProve.exchange.robinhood.connect.useMutation()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RobinhoodFormData>({
    resolver: zodResolver(robinhoodFormSchema),
    defaultValues: { apiKey: '', privateKey: '', displayName: routeState?.displayName ?? '' },
  })

  async function onSubmit(data: RobinhoodFormData): Promise<void> {
    setStep('loading')
    try {
      const account = await connectMutation.mutateAsync({
        apiKey: data.apiKey,
        privateKeyBase64: data.privateKey,
        displayName: data.displayName,
        replaceAccountId,
      })
      setConnectedAccount(account)
      setStep('success')
      void utils.portalProve.controlCenter.getData.invalidate()
      void utils.portalProve.exchange.list.invalidate()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Robinhood account'
      toast.error(message)
      setStep('form')
    }
  }

  if (step === 'loading') {
    return <ExchangeConnecting exchange="robinhood" />
  }

  if (step === 'success' && connectedAccount) {
    return (
      <ExchangeConnected
        exchange="robinhood"
        account={connectedAccount}
        isReconnect={isReconnect}
        returnTo={returnTo}
      />
    )
  }

  return (
    <ClaimConnectionWrapper>
      <form
        onSubmit={(event) => {
          handleSubmit(onSubmit)(event).catch(() => {
            toast.error('Unable to submit the connection form. Please try again.')
          })
        }}
      >
        <Stack gap={6} pt={8} pb={WizardFooter.padding}>
          {/* Header */}
          <Flex align="center" gap={3}>
            <img src="/images/exchanges/robinhood-icon.svg" alt="Robinhood" style={{ height: '32px' }} />
            <Heading as="h1" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
              {isReconnect ? 'Reconnect Robinhood Account' : 'Connect Robinhood Account'}
            </Heading>
          </Flex>
          <Text textStyle="text/md" color="neutral.600">
            Enter your Robinhood Crypto API credentials to import your Bitcoin balance and order history. Only read-only
            access is required.
          </Text>

          {/* Form fields */}
          <Stack gap={4}>
            <FormControl isInvalid={!!errors.displayName}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                Account Name
              </FormLabel>
              <Input {...register('displayName')} placeholder="e.g. My Robinhood Account" />
              <FormErrorMessage>{errors.displayName?.message}</FormErrorMessage>
            </FormControl>

            <FormControl isInvalid={!!errors.apiKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                API Key
              </FormLabel>
              <Input
                {...register('apiKey')}
                placeholder="e.g. rh-api-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                fontFamily="mono"
              />
              <FormErrorMessage>{errors.apiKey?.message}</FormErrorMessage>
            </FormControl>

            <FormControl isInvalid={!!errors.privateKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                Private Key (Base64)
              </FormLabel>
              <Input
                {...register('privateKey')}
                placeholder="Paste your base64-encoded private key"
                fontFamily="mono"
                type="password"
              />
              <FormErrorMessage>{errors.privateKey?.message}</FormErrorMessage>
            </FormControl>
          </Stack>

          {/* Instructions */}
          <Box bg="neutral.50" borderRadius="md" p={4}>
            <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" mb={2}>
              How to set up Robinhood Crypto API credentials
            </Text>
            <Stack gap={2} as="ol" listStyleType="decimal" pl={4}>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Generate an Ed25519 key pair using the script in{' '}
                <Text
                  as="a"
                  href="https://docs.robinhood.com/crypto/trading/#section/Authentication"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="neutral.900"
                  textDecoration="underline"
                >
                  Robinhood&apos;s API docs
                </Text>
                . Save both the private key (base64) and public key (base64).
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Open{' '}
                <Text
                  as="a"
                  href="https://robinhood.com/account/crypto"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="neutral.900"
                  textDecoration="underline"
                >
                  Robinhood Crypto Account Settings
                </Text>{' '}
                and create an API credential using your public key.
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Copy the API key (e.g. rh-api-...) and your base64 private key, then paste them above. Both will be
                encrypted and stored securely.
              </Text>
            </Stack>
          </Box>

          {/* Info box */}
          <Box border="1px solid" borderColor="neutral.200" borderRadius="md" p={4} bg="shades.0">
            <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" mb={1}>
              What is being accessed?
            </Text>
            <Text textStyle="text/sm" color="neutral.600">
              Only your Bitcoin holdings and order history are read. No trading or withdrawal permissions are required
              or granted.
            </Text>
          </Box>
        </Stack>

        <WizardFooter
          leftButton={
            <Button
              variant="outline"
              onClick={() => {
                void navigate(returnTo)
              }}
            >
              Cancel
            </Button>
          }
          rightButton={<Button type="submit">{isReconnect ? 'Reconnect Account' : 'Connect Account'}</Button>}
        />
      </form>
    </ClaimConnectionWrapper>
  )
}
