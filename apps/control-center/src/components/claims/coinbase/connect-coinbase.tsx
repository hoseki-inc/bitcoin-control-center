import {
  Box,
  Button,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Grid,
  Heading,
  Input,
  Link,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ClaimConnectionWrapper, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  KeyRound,
  Lock,
  Menu,
  Settings,
  X,
} from 'lucide-react'
import { type ChangeEvent, type ClipboardEvent, useState } from 'react'
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
import { detectCoinbaseKeyKind, trySplitCoinbaseKeyJson } from './coinbase-key-helpers'

type ConnectedAccount = RouterOutput['portalProve']['exchanges']['coinbase']['connect']

const COINBASE_PORTAL_URL = 'https://portal.cdp.coinbase.com'
const INVALID_SECRET_ERROR_MESSAGE = 'This is not a valid API Key Secret. Copy it from Coinbase and paste it again.'

const coinbaseFormSchema = z.object({
  apiKey: z.string().min(1, 'API Key ID is required'),
  secretKey: z.string().min(1, 'API Key Secret is required'),
})

type CoinbaseFormData = z.infer<typeof coinbaseFormSchema>

type FlowStep = 'form' | 'loading' | 'success'
type GuideStep = 1 | 2 | 3

const GUIDE_STEPS: ReadonlyArray<{ num: GuideStep; label: string }> = [
  { num: 1, label: 'Find API Keys' },
  { num: 2, label: 'Configure key' },
  { num: 3, label: 'Paste key' },
]

function CoinbaseNavStep(): JSX.Element {
  return (
    <Stack bg="neutral.50" border="1px solid" borderColor="neutral.200" borderRadius="xl" p={4} gap={3}>
      <Flex
        wrap="wrap"
        align="center"
        gap={1.5}
        px={3}
        py={2.5}
        bg="shades.0"
        border="1px solid"
        borderColor="neutral.200"
        borderRadius="lg"
        aria-label="Coinbase navigation path"
      >
        <Flex align="center" gap={1.5} px={2.5} py={1} borderRadius="md" bg="#F4F6F9" color="#0A0B0D">
          <Menu size={12} aria-hidden="true" />
          <Text textStyle="label/sm" fontWeight="medium">
            Menu
          </Text>
        </Flex>
        <Box color="neutral.400" aria-hidden="true">
          <ChevronRight size={12} />
        </Box>
        <Flex align="center" gap={1.5} px={2.5} py={1} borderRadius="md" bg="#F4F6F9" color="#0A0B0D">
          <Settings size={12} aria-hidden="true" />
          <Text textStyle="label/sm" fontWeight="medium">
            Settings
          </Text>
        </Flex>
        <Box color="neutral.400" aria-hidden="true">
          <ChevronRight size={12} />
        </Box>
        <Flex align="center" gap={1.5} px={2.5} py={1} borderRadius="md" bg="#F4F6F9" color="#0A0B0D">
          <KeyRound size={12} aria-hidden="true" />
          <Text textStyle="label/sm" fontWeight="medium">
            API Keys
          </Text>
        </Flex>
        <Box color="neutral.400" aria-hidden="true">
          <ChevronRight size={12} />
        </Box>
        <Box px={3} py={1} borderRadius="full" bg="#0052FF" color="shades.0">
          <Text textStyle="label/sm" fontWeight="semibold">
            Create secret API key
          </Text>
        </Box>
      </Flex>

      <Stack bg="shades.0" border="1px solid" borderColor="neutral.200" borderRadius="lg" p={3.5} gap={2.5}>
        {[
          'Click Open Coinbase above and sign in to Coinbase Developer Platform.',
          'Click the top left menu icon, choose Settings, and choose API Keys.',
          'Click Create secret API key to open the key dialog.',
        ].map((instruction, index) => (
          <Flex key={instruction} align="center" gap={2.5}>
            <Flex
              boxSize={5}
              flexShrink={0}
              borderRadius="full"
              bg="shades.0"
              border="1px solid"
              borderColor="neutral.300"
              align="center"
              justify="center"
              color="neutral.900"
            >
              <Text textStyle="label/xs" fontWeight="semibold">
                {index + 1}
              </Text>
            </Flex>
            <Text textStyle="text/sm" color="neutral.700">
              {instruction}
            </Text>
          </Flex>
        ))}
      </Stack>
    </Stack>
  )
}

function CoinbaseDialogPreview(): JSX.Element {
  return (
    <Box bg="neutral.50" border="1px solid" borderColor="neutral.200" borderRadius="xl" p={4}>
      <Box
        bg="shades.0"
        border="1px solid"
        borderColor="#D6DBE2"
        borderRadius="xl"
        overflow="hidden"
        aria-label="Coinbase Create secret API key settings"
      >
        <Flex align="center" justify="space-between" px={3.5} py={2.5} borderBottom="1px solid" borderColor="#EEF0F3">
          <Box w={3.5} aria-hidden="true" />
          <Text textStyle="text/sm" fontWeight="bold" color="#0A0B0D">
            Create secret API key
          </Text>
          <Box color="#8A919E" aria-hidden="true">
            <X size={13} />
          </Box>
        </Flex>

        <Stack px={3.5} py={3} gap={2.5}>
          <Stack gap={1}>
            <Text textStyle="label/sm" color="#5B616E">
              API key nickname
            </Text>
            <Box px={2.5} py={1.5} borderRadius="lg" border="1px solid" borderColor="#D6DBE2" bg="shades.0">
              <Text textStyle="text/sm" color="#0A0B0D">
                Bitcoin Control Center
              </Text>
            </Box>
          </Stack>

          <Stack gap={1}>
            <Text textStyle="label/sm" fontWeight="bold" color="#0A0B0D">
              IP allowlist
            </Text>
            <Flex
              align="center"
              gap={2}
              px={2.5}
              py={1.5}
              borderRadius="lg"
              bg="#F0F5FF"
              border="1px solid"
              borderColor="#C7DBFF"
            >
              <Flex
                boxSize={4}
                flexShrink={0}
                borderRadius="4px"
                bg="#0052FF"
                color="shades.0"
                align="center"
                justify="center"
                aria-hidden="true"
              >
                <Check size={10} strokeWidth={3} />
              </Flex>
              <Text textStyle="text/xs" fontWeight="medium" color="#0A0B0D">
                Allow requests from any IP address
              </Text>
            </Flex>
          </Stack>

          <Box h="1px" bg="#EEF0F3" />

          <Stack gap={2}>
            <Flex align="center" justify="space-between">
              <Text textStyle="text/md" fontWeight="regular" color="#0A0B0D">
                Coinbase App &amp; Advanced Trade
              </Text>
              <Box color="#5B616E" aria-hidden="true">
                <ChevronUp size={14} />
              </Box>
            </Flex>

            <Stack gap={1}>
              <Text textStyle="label/sm" fontWeight="bold" color="#0A0B0D">
                Portfolio
              </Text>
              <Flex
                align="center"
                justify="space-between"
                gap={2}
                px={3}
                py={1.5}
                borderRadius="lg"
                border="1.5px solid"
                borderColor="#0052FF"
                bg="shades.0"
              >
                <Flex align="baseline" wrap="wrap" gap={1.5}>
                  <Text textStyle="text/sm" fontWeight="medium" color="#0A0B0D">
                    Primary
                  </Text>
                  <Text textStyle="text/xs" fontStyle="italic" color="#5B616E">
                    (or the portfolio you want to track)
                  </Text>
                </Flex>
                <Box color="#0A0B0D" flexShrink={0} aria-hidden="true">
                  <ChevronDown size={14} />
                </Box>
              </Flex>
            </Stack>

            <Stack gap={1.5}>
              <Flex
                align="center"
                gap={2}
                px={2.5}
                py={1.5}
                borderRadius="lg"
                bg="#F0F5FF"
                border="1px solid"
                borderColor="#C7DBFF"
              >
                <Flex
                  boxSize={4}
                  flexShrink={0}
                  borderRadius="4px"
                  bg="#0052FF"
                  color="shades.0"
                  align="center"
                  justify="center"
                  aria-hidden="true"
                >
                  <Check size={10} strokeWidth={3} />
                </Flex>
                <Text textStyle="text/xs" fontWeight="medium" color="#0A0B0D">
                  Read
                </Text>
              </Flex>

              <Grid templateColumns={['1fr', 'repeat(3, minmax(0, 1fr))']} gap={1.5}>
                {['Trade', 'Transfer', 'Receive'].map((permission) => (
                  <Flex
                    key={permission}
                    align="center"
                    gap={2}
                    px={2}
                    py={1}
                    borderRadius="lg"
                    border="1px solid"
                    borderColor="#EEF0F3"
                    bg="#FAFBFD"
                  >
                    <Box
                      boxSize={4}
                      flexShrink={0}
                      borderRadius="4px"
                      border="1.5px solid"
                      borderColor="#B7BEC9"
                      bg="shades.0"
                      aria-hidden="true"
                    />
                    <Text textStyle="text/xs" color="#8A919E">
                      {permission}
                    </Text>
                  </Flex>
                ))}
              </Grid>
            </Stack>
          </Stack>
        </Stack>

        <Flex justify="flex-end" align="center" gap={2} px={3.5} py={2} borderTop="1px solid" borderColor="#EEF0F3">
          <Box px={3.5} py={1} borderRadius="full" bg="#EEF0F3">
            <Text textStyle="label/sm" fontWeight="semibold" color="#0A0B0D">
              Cancel
            </Text>
          </Box>
          <Box px={4} py={1} borderRadius="full" bg="#0052FF">
            <Text textStyle="label/sm" fontWeight="semibold" color="shades.0">
              Create
            </Text>
          </Box>
        </Flex>
      </Box>
    </Box>
  )
}

export function ConnectCoinbase(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = parseNavigationState(location.state)
  const returnTo = routeState?.returnTo ?? '/accounts'
  const replaceAccountId = routeState?.replaceAccountId
  const isReconnect = Boolean(replaceAccountId)
  const [flowStep, setFlowStep] = useState<FlowStep>('form')
  const [guideStep, setGuideStep] = useState<GuideStep>(isReconnect ? 3 : 1)
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null)
  const [completedAsReconnect, setCompletedAsReconnect] = useState(isReconnect)
  const [submitError, setSubmitError] = useState<ExchangeConnectErrorState | null>(null)
  const [filledFromJson, setFilledFromJson] = useState(false)

  const utils = trpc.useUtils()
  const connectMutation = trpc.portalProve.exchanges.coinbase.connect.useMutation()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CoinbaseFormData>({
    resolver: zodResolver(coinbaseFormSchema),
    defaultValues: { apiKey: '', secretKey: '' },
  })

  const secretKeyValue = watch('secretKey')
  const detectedKeyKind = detectCoinbaseKeyKind(secretKeyValue)
  const isServerFormatRejection = submitError?.message === INVALID_SECRET_ERROR_MESSAGE
  const detectedLabel = isServerFormatRejection
    ? null
    : detectedKeyKind === 'ed25519'
      ? 'Ed25519 key detected'
      : detectedKeyKind === 'ecdsa'
        ? 'ECDSA key detected'
        : detectedKeyKind === 'pem'
          ? 'PEM key detected'
          : null
  const formatWarning = detectedKeyKind === 'invalid' ? INVALID_SECRET_ERROR_MESSAGE : null

  function applySplitJson(split: { apiKey: string; secretKey: string }): void {
    setSubmitError(null)
    setValue('apiKey', split.apiKey, { shouldValidate: true, shouldDirty: true })
    setValue('secretKey', split.secretKey, { shouldValidate: true, shouldDirty: true })
    setFilledFromJson(true)
  }

  function handleJsonPaste(event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    const pastedText = event.clipboardData.getData('text')
    const split = trySplitCoinbaseKeyJson(pastedText)
    if (split !== null) {
      event.preventDefault()
      applySplitJson(split)
    }
  }

  async function submitConnection(data: CoinbaseFormData, options: { asNewAccount: boolean }): Promise<void> {
    setSubmitError(null)
    setFlowStep('loading')
    const targetReplaceId = options.asNewAccount ? undefined : replaceAccountId
    try {
      const account = await connectMutation.mutateAsync({
        apiKey: data.apiKey,
        secretKey: data.secretKey,
        replaceAccountId: targetReplaceId,
      })
      setConnectedAccount(account)
      setCompletedAsReconnect(Boolean(targetReplaceId))
      setFlowStep('success')
      void utils.portalProve.portfolio.getData.invalidate()
      void utils.portalProve.exchanges.list.invalidate()
      void utils.portalProve.exchanges.coinbase.list.invalidate()
    } catch (err) {
      const parsed =
        err instanceof Error
          ? parseExchangeConnectError(err, 'Failed to connect Coinbase account')
          : { message: 'Failed to connect Coinbase account', isMismatch: false }
      reset(data)
      setSubmitError(parsed)
      setFlowStep('form')
      setGuideStep(3)
    }
  }

  async function onSubmit(data: CoinbaseFormData): Promise<void> {
    await submitConnection(data, { asNewAccount: false })
  }

  function handleConnectAsNew(): void {
    handleSubmit(async (data) => {
      await submitConnection(data, { asNewAccount: true })
    })().catch(() => {
      toast.error('Unable to submit the connection form. Please try again.')
    })
  }

  if (flowStep === 'loading') {
    return <ExchangeConnecting exchange="coinbase" />
  }

  if (flowStep === 'success' && connectedAccount) {
    return (
      <ExchangeConnected
        exchange="coinbase"
        account={connectedAccount}
        isReconnect={completedAsReconnect}
        returnTo={completedAsReconnect ? returnTo : '/accounts'}
      />
    )
  }

  const heading =
    guideStep === 1
      ? 'Open Coinbase API Keys'
      : guideStep === 2
        ? 'Match these key settings'
        : isReconnect
          ? 'Reconnect Coinbase account'
          : 'Paste your Coinbase API key'

  const subtext =
    guideStep === 1
      ? 'Control Center reads your Bitcoin balance and cannot move funds.'
      : guideStep === 2
        ? 'Turn on Read access only so Control Center cannot move funds.'
        : 'Control Center supports both Ed25519 and ECDSA keys.'

  const apiKeyField = register('apiKey')
  const secretKeyField = register('secretKey')

  return (
    <ClaimConnectionWrapper>
      <form
        onSubmit={(event) => {
          handleSubmit(onSubmit)(event).catch(() => {
            toast.error('Unable to submit the connection form. Please try again.')
          })
        }}
      >
        <Stack gap={4} pt={5} pb={WizardFooter.padding}>
          <Flex align="center" gap={2} wrap="wrap">
            {GUIDE_STEPS.map((step, index) => {
              const isActive = step.num === guideStep
              const isDone = step.num < guideStep
              return (
                <Flex key={step.num} align="center" gap={2}>
                  <Button
                    type="button"
                    variant="unstyled"
                    display="inline-flex"
                    alignItems="center"
                    gap={1.5}
                    h="auto"
                    minW="auto"
                    color={isActive ? 'neutral.900' : isDone ? 'success.700' : 'neutral.500'}
                    fontWeight={isActive ? 'semibold' : 'medium'}
                    onClick={() => {
                      setGuideStep(step.num)
                    }}
                  >
                    <Flex
                      boxSize={5}
                      borderRadius="full"
                      align="center"
                      justify="center"
                      bg={isActive ? 'neutral.900' : isDone ? 'success.50' : 'neutral.100'}
                      color={isActive ? 'shades.0' : isDone ? 'success.600' : 'neutral.600'}
                      border={isDone ? '1px solid' : 'none'}
                      borderColor={isDone ? 'success.200' : 'transparent'}
                    >
                      {isDone ? (
                        <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                      ) : (
                        <Text textStyle="label/xs" fontWeight="semibold">
                          {step.num}
                        </Text>
                      )}
                    </Flex>
                    <Text textStyle="label/sm">{step.label}</Text>
                  </Button>
                  {index < GUIDE_STEPS.length - 1 ? <Box w={6} h="1px" bg="neutral.200" aria-hidden="true" /> : null}
                </Flex>
              )
            })}
          </Flex>

          <Stack gap={1}>
            <Flex align="center" justify="space-between" gap={3} wrap="wrap">
              <Flex align="center" gap={2.5}>
                <img src="/images/exchanges/coinbase.svg" alt="Coinbase" style={{ height: '28px' }} />
                <Heading as="h1" textStyle="text/xl" fontWeight="semibold" color="neutral.900">
                  {heading}
                </Heading>
              </Flex>
              {guideStep !== 3 ? (
                <Link
                  href={COINBASE_PORTAL_URL}
                  isExternal
                  display="inline-flex"
                  alignItems="center"
                  gap={1.5}
                  px={3}
                  py={1.5}
                  borderRadius="md"
                  bg="shades.0"
                  border="1px solid"
                  borderColor="neutral.200"
                  color="neutral.900"
                  _hover={{ bg: 'neutral.100', borderColor: 'neutral.300', textDecoration: 'none' }}
                >
                  <Text textStyle="label/sm" fontWeight="semibold">
                    Open Coinbase
                  </Text>
                  <ExternalLink size={12} aria-hidden="true" />
                </Link>
              ) : null}
            </Flex>
            <Text textStyle="text/sm" color="neutral.600">
              {subtext}
            </Text>
          </Stack>

          {guideStep === 1 ? <CoinbaseNavStep /> : null}
          {guideStep === 2 ? <CoinbaseDialogPreview /> : null}

          {guideStep === 3 ? (
            <Stack gap={3.5}>
              {submitError !== null ? (
                <ExchangeReconnectError
                  exchangeName="Coinbase"
                  error={submitError}
                  onConnectAsNew={handleConnectAsNew}
                />
              ) : null}

              <FormControl isInvalid={!!errors.apiKey}>
                <FormLabel mb={1.5} textStyle="text/sm" fontWeight="medium" color="neutral.700">
                  API Key ID
                </FormLabel>
                <Input
                  {...apiKeyField}
                  onPaste={handleJsonPaste}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const split = trySplitCoinbaseKeyJson(event.target.value)
                    if (split !== null) {
                      applySplitJson(split)
                      return
                    }
                    setFilledFromJson(false)
                    setSubmitError(null)
                    void apiKeyField.onChange(event)
                  }}
                  placeholder="Paste your API Key ID"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  fontFamily="mono"
                  textStyle="text/sm"
                />
                <FormErrorMessage>{errors.apiKey?.message}</FormErrorMessage>
              </FormControl>

              <FormControl isInvalid={!!errors.secretKey || formatWarning !== null}>
                <FormLabel mb={1.5} textStyle="text/sm" fontWeight="medium" color="neutral.700">
                  API Key Secret
                </FormLabel>
                <Textarea
                  {...secretKeyField}
                  onPaste={handleJsonPaste}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    const split = trySplitCoinbaseKeyJson(event.target.value)
                    if (split !== null) {
                      applySplitJson(split)
                      return
                    }
                    setFilledFromJson(false)
                    setSubmitError(null)
                    void secretKeyField.onChange(event)
                  }}
                  placeholder="Paste your API Key Secret"
                  rows={4}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  fontFamily="mono"
                  textStyle="text/sm"
                />
                {detectedLabel !== null || filledFromJson ? (
                  <Flex mt={1.5} align="center" gap={2} wrap="wrap">
                    {detectedLabel !== null ? (
                      <Flex
                        align="center"
                        gap={1.5}
                        px={2.5}
                        py={0.5}
                        borderRadius="full"
                        bg="success.50"
                        color="success.600"
                      >
                        <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                        <Text textStyle="label/sm" fontWeight="medium">
                          {detectedLabel}
                        </Text>
                      </Flex>
                    ) : null}
                    {filledFromJson ? (
                      <Box px={2.5} py={0.5} borderRadius="full" bg="neutral.100" color="neutral.700">
                        <Text textStyle="label/sm" fontWeight="medium">
                          Both fields filled from JSON
                        </Text>
                      </Box>
                    ) : null}
                  </Flex>
                ) : null}
                <FormErrorMessage>{errors.secretKey?.message ?? formatWarning}</FormErrorMessage>
              </FormControl>

              <Flex
                align="center"
                gap={2.5}
                px={3}
                py={2.5}
                border="1px solid"
                borderColor="neutral.200"
                borderRadius="md"
                bg="shades.0"
                color="neutral.600"
              >
                <Lock size={15} aria-hidden="true" />
                <Text textStyle="text/xs">Your key stays encrypted on this device.</Text>
              </Flex>
            </Stack>
          ) : null}
        </Stack>

        <WizardFooter
          leftButton={
            guideStep === 1 || (guideStep === 3 && isReconnect) ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigate(returnTo)
                }}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setGuideStep(guideStep === 3 ? 2 : 1)
                }}
              >
                Back
              </Button>
            )
          }
          rightButton={
            guideStep === 1 ? (
              <Button
                type="button"
                onClick={() => {
                  setGuideStep(2)
                }}
              >
                Next
              </Button>
            ) : guideStep === 2 ? (
              <Button
                type="button"
                onClick={() => {
                  setGuideStep(3)
                }}
              >
                I have my key
              </Button>
            ) : (
              <Button type="submit">{isReconnect ? 'Reconnect Account' : 'Connect Account'}</Button>
            )
          }
        />
      </form>
    </ClaimConnectionWrapper>
  )
}
