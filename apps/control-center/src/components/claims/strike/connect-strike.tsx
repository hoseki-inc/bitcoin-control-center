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
import { parseNavigationState } from '../../../lib/navigation-state'
import { type RouterOutput, trpc } from '../../../trpc'

type ConnectedAccount = RouterOutput['portalProve']['exchange']['strike']['connect']

const strikeFormSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  displayName: z.string().min(1, 'Display name is required'),
})

type StrikeFormData = z.infer<typeof strikeFormSchema>

type Step = 'form' | 'loading' | 'success'

export function ConnectStrike(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = parseNavigationState(location.state)
  const returnTo = routeState?.returnTo ?? '/accounts'
  const replaceAccountId = routeState?.replaceAccountId
  const isReconnect = Boolean(replaceAccountId)
  const successPath = isReconnect ? returnTo : '/accounts'
  const [step, setStep] = useState<Step>('form')
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null)

  const utils = trpc.useUtils()
  const connectMutation = trpc.portalProve.exchange.strike.connect.useMutation()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<StrikeFormData>({
    resolver: zodResolver(strikeFormSchema),
    defaultValues: { apiKey: '', displayName: routeState?.displayName ?? '' },
  })

  async function onSubmit(data: StrikeFormData): Promise<void> {
    setStep('loading')
    try {
      const account = await connectMutation.mutateAsync({
        apiKey: data.apiKey,
        displayName: data.displayName,
        replaceAccountId,
      })
      setConnectedAccount(account)
      setStep('success')
      // Invalidate cached control center data so charts refresh with new exchange data
      void utils.portalProve.controlCenter.getData.invalidate()
      void utils.portalProve.exchange.list.invalidate()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Strike account'
      toast.error(message)
      setStep('form')
    }
  }

  if (step === 'loading') {
    return (
      <PageTransition>
        <Receipt title="Connecting to Strike..." state="loading" />
      </PageTransition>
    )
  }

  if (step === 'success' && connectedAccount) {
    return (
      <PageTransition>
        <Fireworks autorun={{ speed: 2, duration: 5_000, delay: 500 }} />
        <Receipt
          title={isReconnect ? 'Strike Reconnected!' : 'Strike Connected!'}
          state="success"
          onClose={() => {
            void navigate(successPath)
          }}
          closeTitle={isReconnect ? 'Back to Account' : 'Go to Accounts'}
          content={
            <VStack spacing={8}>
              <img src="/images/exchanges/strike-icon.svg" alt="Strike" style={{ height: '64px' }} />
              <Text textStyle="text/2xl" color="neutral.900" textAlign="center">
                Your Strike account &ldquo;{connectedAccount.displayName}&rdquo; is now{' '}
                {isReconnect ? 'reconnected' : 'connected'}.
              </Text>
              <HStack spacing={4}>
                {!isReconnect && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigate('/accounts/add')
                    }}
                  >
                    Connect Another Account
                  </Button>
                )}
                <Button
                  onClick={() => {
                    void navigate(successPath)
                  }}
                >
                  {isReconnect ? 'Back to Account' : 'Go to Accounts'}
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
            <img src="/images/exchanges/strike-icon.svg" alt="Strike" style={{ height: '32px' }} />
            <Heading textStyle="text/2xl" fontWeight="bold" color="neutral.900">
              {isReconnect ? 'Reconnect Strike Account' : 'Connect Strike Account'}
            </Heading>
          </Flex>
          <Text textStyle="text/md" color="neutral.600">
            Enter your Strike API key to import your Bitcoin balance. Only read-only access is required.
          </Text>

          {/* Form fields */}
          <Stack gap={4}>
            <FormControl isInvalid={!!errors.displayName}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                Account Name
              </FormLabel>
              <Input {...register('displayName')} placeholder="e.g. My Strike Account" />
              <FormErrorMessage>{errors.displayName?.message}</FormErrorMessage>
            </FormControl>

            <FormControl isInvalid={!!errors.apiKey}>
              <FormLabel textStyle="text/sm" color="neutral.600">
                API Key
              </FormLabel>
              <Input {...register('apiKey')} placeholder="Paste your Strike API key" fontFamily="mono" />
              <FormErrorMessage>{errors.apiKey?.message}</FormErrorMessage>
            </FormControl>
          </Stack>

          {/* Instructions */}
          <Box bg="neutral.50" borderRadius="md" p={4}>
            <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900" mb={2}>
              How to create a Strike API key
            </Text>
            <Stack gap={2} as="ol" listStyleType="decimal" pl={4}>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Go to{' '}
                <Text
                  as="a"
                  href="https://dashboard.strike.me/developer/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="neutral.900"
                  textDecoration="underline"
                >
                  Strike Developer Dashboard
                </Text>{' '}
                and sign in.
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Click &ldquo;Generate API Key&rdquo; and give it a descriptive name like &ldquo;Bitcoin Control
                Center&rdquo;.
              </Text>
              <Text as="li" textStyle="text/sm" color="neutral.700">
                Copy the API key and paste it above. Your key will be encrypted and stored securely.
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
