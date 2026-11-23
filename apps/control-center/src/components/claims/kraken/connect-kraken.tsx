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
import {
  type ExchangeConnectErrorState,
  ExchangeReconnectError,
  parseExchangeConnectError,
} from '../exchange-reconnect-error'

type ConnectedAccount = RouterOutput['portalProve']['exchanges']['kraken']['connect']

const krakenFormSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  secretKey: z.string().min(1, 'Secret Key is required'),
})

type KrakenFormData = z.infer<typeof krakenFormSchema>

type Step = 'form' | 'loading' | 'success'

export function ConnectKraken(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = parseNavigationState(location.state)
  const returnTo = routeState?.returnTo ?? '/accounts'
  const replaceAccountId = routeState?.replaceAccountId
  const isReconnect = Boolean(replaceAccountId)
  const [step, setStep] = useState<Step>('form')
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null)
  const [completedAsReconnect, setCompletedAsReconnect] = useState(isReconnect)
  const [submitError, setSubmitError] = useState<ExchangeConnectErrorState | null>(null)

  const utils = trpc.useUtils()
  const connectMutation = trpc.portalProve.exchanges.kraken.connect.useMutation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<KrakenFormData>({
    resolver: zodResolver(krakenFormSchema),
    defaultValues: { apiKey: '', secretKey: '' },
  })

  async function submitConnection(data: KrakenFormData, options: { asNewAccount: boolean }): Promise<void> {
    setSubmitError(null)
    setStep('loading')
    const targetReplaceId = options.asNewAccount ? undefined : replaceAccountId
    try {
      const account = await connectMutation.mutateAsync({
        apiKey: data.apiKey,
        secretKey: data.secretKey,
        replaceAccountId: targetReplaceId,
      })
      setConnectedAccount(account)
      setCompletedAsReconnect(Boolean(targetReplaceId))
      setStep('success')
      void utils.portalProve.portfolio.getData.invalidate()
      void utils.portalProve.exchanges.list.invalidate()
      void utils.portalProve.exchanges.kraken.list.invalidate()
    } catch (err) {
      const parsed =
        err instanceof Error
          ? parseExchangeConnectError(err, 'Failed to connect Kraken account')
          : { message: 'Failed to connect Kraken account', isMismatch: false }
      reset(data)
      setSubmitError(parsed)
      setStep('form')
    }
  }

  async function onSubmit(data: KrakenFormData): Promise<void> {
    await submitConnection(data, { asNewAccount: false })
  }

  function handleConnectAsNew(): void {
    handleSubmit(async (data) => {
      await submitConnection(data, { asNewAccount: true })
    })().catch(() => {
      toast.error('Unable to submit the connection form. Please try again.')
    })
  }

  if (step === 'loading') {
    return <ExchangeConnecting exchange="kraken" />
  }

  if (step === 'success' && connectedAccount) {
    return (
      <ExchangeConnected
        exchange="kraken"
        account={connectedAccount}
        isReconnect={completedAsReconnect}
        returnTo={completedAsReconnect ? returnTo : '/accounts'}
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
            <img src="/images/exchanges/kraken.svg" alt="Kraken" style={{ height: '32px' }} />
            <Heading as="h1" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
              {isReconnect ? 'Reconnect Kraken Account' : 'Connect Kraken Account'}
            </Heading>
          </Flex>
          <Text textStyle="text/md" color="neutral.600">
            Enter your Kraken API credentials to import your Bitcoin balance. Only read-only access is required.
          </Text>

          {submitError !== null ? (
            <ExchangeReconnectError exchangeName="Kraken" error={submitError} onConnectAsNew={handleConnectAsNew} />
          ) : null}

          {/* Form fields */}
          <Stack gap={4}>
            <FormControl isInvalid={!!errors.apiKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                API Key
              </FormLabel>
              <Input {...register('apiKey')} placeholder="Your Kraken API key" fontFamily="mono" textStyle="text/sm" />
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
                textStyle="text/sm"
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
                  href="https://www.kraken.com/c/account-settings/api"
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
