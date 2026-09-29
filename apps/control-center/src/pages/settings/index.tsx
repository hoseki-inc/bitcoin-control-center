import {
  Box,
  Button,
  ButtonGroup,
  Circle,
  Divider,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  VStack,
  keyframes,
  useToken,
} from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { isDesktop } from '../../mode'
import type { RouterInput } from '../../trpc'

type ElectrumStatusState = { status: ElectrumStatus | null; refresh: () => void }

const ReconnectErrorSchema = z.object({
  error: z.object({
    json: z.object({ message: z.string() }).optional().catch(undefined),
    message: z.string().optional().catch(undefined),
  }),
})

export function SettingsPage({ desktop = isDesktop }: { desktop?: boolean }): JSX.Element {
  const { data: savedName, isLoading, saveAsync, isSaving, isError } = useLocalSetting('user_name')
  const [draftName, setDraftName] = useState<string | null>(null)
  const name = draftName ?? savedName ?? ''

  const handleSave = async (): Promise<void> => {
    try {
      await saveAsync(name.trim())
      setDraftName(null)
      toast.success('Name saved')
    } catch {
      toast.error('Could not save your name. Please try again.')
    }
  }

  return (
    <Box py={{ base: 6, md: 10 }} maxW="960px">
      <PageHeading title="Settings" description="App preferences and personal information." />
      <Stack mt={{ base: 8, md: 10 }} spacing={8} divider={<Divider borderColor="neutral.200" />}>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
          <Box>
            <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
              Personal information
            </Text>
            <Text id="user-name-description" mt={2} textStyle="text/sm" color="neutral.600" maxW="32ch">
              This name will appear on your generated statements.
            </Text>
          </Box>
          <Box
            as="form"
            onSubmit={(event: React.FormEvent) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            <FormControl isDisabled={isLoading || isSaving || isError}>
              <FormLabel htmlFor="user-name" textStyle="text/sm" mb={2}>
                Your name
              </FormLabel>
              <Input
                id="user-name"
                autoComplete="name"
                aria-describedby="user-name-description"
                maxLength={200}
                placeholder="Enter your name"
                value={name}
                onChange={(event) => {
                  setDraftName(event.target.value)
                }}
              />
              {isError && (
                <Text role="alert" textStyle="text/sm" color="error.700" mt={2}>
                  Could not load your name. Refresh to try again.
                </Text>
              )}
              <Button
                type="submit"
                size="sm"
                mt={4}
                isLoading={isSaving}
                loadingText="Saving"
                isDisabled={isLoading || isError || name.trim() === (savedName ?? '')}
              >
                Save name
              </Button>
            </FormControl>
          </Box>
        </SimpleGrid>
        {desktop && <ElectrumSettings />}
      </Stack>
    </Box>
  )
}

// ─── Desktop-only: Electrum Server Settings ──────────────────────────────────

interface ServerPreset {
  label: string
  host: string
  port: string
  protocol: 'tcp' | 'ssl'
  tor: boolean
}

const SERVER_PRESETS: ServerPreset[] = [
  { label: 'Blockstream (Public)', host: 'electrum.blockstream.info', port: '50002', protocol: 'ssl', tor: false },
  { label: 'Mempool.space (Public)', host: 'electrum.mempool.space', port: '50002', protocol: 'ssl', tor: false },
]

const ElectrumStatusSchema = z.object({
  connected: z.boolean(),
  host: z.string(),
  port: z.number(),
  protocol: z.string(),
  tor: z
    .object({
      state: z.enum(['stopped', 'starting', 'ready', 'failed', 'unavailable']),
      message: z.string().optional(),
      progress: z.number().optional(),
      attempt: z.number().optional(),
    })
    .optional(),
})
type ElectrumStatus = z.infer<typeof ElectrumStatusSchema>
const ElectrumStatusResponseSchema = z.object({
  result: z.object({ data: z.unknown() }),
})

function useElectrumStatus(): ElectrumStatusState {
  const [status, setStatus] = useState<ElectrumStatus | null>(null)

  const refresh = useCallback((): void => {
    const baseUrl = import.meta.env.VITE_BACKEND_API_URL ?? ''
    void fetch(`${baseUrl}/settings.electrumStatus`)
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- the network response remains untrusted until the schemas below parse it.
      .then(async (res): Promise<unknown> => (res.ok ? res.json() : null))
      .then((data) => {
        // tRPC wraps response in result.data.json (superjson) or result.data
        const response = parseUnknown(ElectrumStatusResponseSchema, data).unwrapOr(null)
        const wrapped = response?.result.data
        const envelope = parseUnknown(z.object({ json: z.unknown() }), wrapped).unwrapOr(null)
        const payload = envelope?.json ?? wrapped
        const parsed = parseUnknown(ElectrumStatusSchema, payload).unwrapOr(null)
        if (parsed?.host != null && parsed.host !== '') {
          setStatus(parsed)
        }
      })
      .catch(() => {
        setStatus(null)
      })
  }, [])

  // Follow Tor startup closely; otherwise a slower check is enough.
  const torStarting = status?.tor?.state === 'starting'
  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, torStarting ? 1000 : 10_000)
    return (): void => {
      clearInterval(interval)
    }
  }, [refresh, torStarting])

  return { status, refresh }
}

// The switch fades between green and light green while Tor starts. The theme
// already stops animation for people who ask their system to reduce motion.
function useTorStartingFade(): string {
  // Resolve theme colors directly; the theme's CSS variable names use a custom prefix.
  const [green, lightGreen] = useToken('colors', ['green.500', 'green.200'])
  return useMemo(
    () => keyframes`
      0%, 100% { background-color: ${green}; }
      50% { background-color: ${lightGreen}; }
    `,
    [green, lightGreen],
  )
}
// Tor usually finishes well before this; after it, reassure rather than alarm.
const TOR_SLOW_START_MS = 30_000
// "Tor ready" stays long enough to read, then fades; the solid switch remains.
const TOR_READY_VISIBLE_MS = 3000
const TOR_READY_FADE_MS = 600

const TorStartResponseSchema = z.object({
  result: z.object({ data: z.object({ json: z.object({ attempt: z.number().optional() }) }) }),
})

/** Start Tor and return the attempt it began, or null if the request failed. */
async function requestTorStart(): Promise<number | null> {
  const baseUrl = import.meta.env.VITE_BACKEND_API_URL ?? ''
  try {
    const res = await fetch(`${baseUrl}/settings.startTor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- the response remains untrusted until parsed below.
    const data: unknown = res.ok ? await res.json() : null
    return parseUnknown(TorStartResponseSchema, data)
      .map((response) => response.result.data.json.attempt ?? 0)
      .unwrapOr(null)
  } catch {
    return null
  }
}

function ElectrumSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const { status: electrumStatus, refresh: refreshStatus } = useElectrumStatus()
  const { data: savedHost, isLoading: hostLoading } = useLocalSetting('electrum_host')
  const { data: savedPort, isLoading: portLoading } = useLocalSetting('electrum_port')
  const { data: savedProtocol, isLoading: protocolLoading } = useLocalSetting('electrum_protocol')
  const { data: savedTorEnabled, isLoading: torLoading } = useLocalSetting('tor_enabled')

  const isLoading = hostLoading || portLoading || protocolLoading || torLoading

  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [protocol, setProtocol] = useState<'tcp' | 'ssl'>('ssl')
  const [torEnabled, setTorEnabled] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [torFailure, setTorFailure] = useState<string | null>(null)
  const [torStartedAt, setTorStartedAt] = useState<number | null>(null)
  // Failures from attempts before this one are stale. Infinity ignores all failures
  // while a start request is in flight; null means none has been requested.
  const [torAttemptAwaited, setTorAttemptAwaited] = useState<number | null>(null)
  const previousTorState = useRef<string | undefined>(undefined)
  const [torReadyNotice, setTorReadyNotice] = useState<'shown' | 'fading' | null>(null)
  const [directConfirmation, setDirectConfirmation] = useState<'test' | 'save' | null>(null)
  const torState = electrumStatus?.tor?.state
  const torAttempt = electrumStatus?.tor?.attempt ?? 0
  const torStarting = torEnabled && torState === 'starting'
  // Connecting without Tor after the saved connection used it, or right after Tor
  // failed, would reveal this computer's IP address. Ask before doing that.
  const leavingTor = !torEnabled && (savedTorEnabled === 'true' || torFailure !== null)
  const torFailedForSavedConnection =
    torFailure !== null || (savedTorEnabled === 'true' && torState === 'failed' && !torEnabled)
  const torStartingFade = useTorStartingFade()

  // Like Sparrow, a failed Tor start turns the switch off. That only changes the
  // form: the saved connection keeps Tor and stays disconnected, never direct.
  // Compare attempts rather than waiting to observe "starting", which a fast failure skips.
  useEffect(() => {
    if (torState === 'failed' && torEnabled && torAttempt >= (torAttemptAwaited ?? 0)) {
      setTorEnabled(false)
      setTorFailure(electrumStatus?.tor?.message ?? 'Tor couldn’t start. Turn Tor on to try again.')
    }
  }, [torState, torEnabled, torAttempt, torAttemptAwaited, electrumStatus?.tor?.message])

  // A saved Tor connection restarts Tor on its own when data is requested. Once Tor
  // is ready again, show the switch on unless the form has been edited.
  useEffect(() => {
    if (torState === 'ready' && savedTorEnabled === 'true' && !isDirty && !torEnabled) {
      setTorEnabled(true)
      setTorFailure(null)
    }
  }, [torState, savedTorEnabled, isDirty, torEnabled])

  // Measure every start, including one begun by a saved Tor connection.
  useEffect(() => {
    setTorStartedAt(torState === 'starting' ? Date.now() : null)
  }, [torState, torAttempt])

  // The solid switch shows Tor is on; announce only the moment startup finishes.
  useEffect(() => {
    if (torState === 'ready' && previousTorState.current === 'starting' && torEnabled) {
      setTorReadyNotice('shown')
    } else if (torState !== 'ready' || !torEnabled) {
      setTorReadyNotice(null)
    }
    previousTorState.current = torState
  }, [torState, torEnabled])

  // Timers rather than an animation, so the notice stays readable when motion is reduced.
  useEffect(() => {
    if (torReadyNotice === null) {
      return undefined
    }
    const timer = setTimeout(
      () => {
        setTorReadyNotice(torReadyNotice === 'shown' ? 'fading' : null)
      },
      torReadyNotice === 'shown' ? TOR_READY_VISIBLE_MS : TOR_READY_FADE_MS,
    )
    return (): void => {
      clearTimeout(timer)
    }
  }, [torReadyNotice])

  const handleTorChange = (enabled: boolean): void => {
    setTorEnabled(enabled)
    setIsDirty(true)
    setTestResult(null)
    setTorFailure(null)
    if (enabled) {
      setTorAttemptAwaited(Number.POSITIVE_INFINITY)
      void requestTorStart().then((attempt) => {
        // If the request failed, the existing status is the one to show.
        setTorAttemptAwaited(attempt ?? 0)
        refreshStatus()
      })
    }
  }

  useEffect(() => {
    if (!isDirty) {
      setHost(savedHost ?? 'electrum.blockstream.info')
      setPort(savedPort ?? '50002')
      setProtocol(savedProtocol === 'tcp' ? 'tcp' : 'ssl')
      setTorEnabled(savedTorEnabled === 'true')
    }
  }, [savedHost, savedPort, savedProtocol, savedTorEnabled, isDirty])

  const buildElectrumPayload = async (): Promise<{ body: string }> => {
    const superjson = (await import('superjson')).default
    const payload: RouterInput['settings']['testElectrum'] = {
      host: host.trim(),
      port: Number(port.trim()),
      protocol,
      torEnabled,
    }
    return {
      body: JSON.stringify(superjson.serialize(payload)),
    }
  }

  const handleTest = async (): Promise<void> => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const baseUrl = import.meta.env.VITE_BACKEND_API_URL ?? ''
      const { body } = await buildElectrumPayload()
      const res = await fetch(`${baseUrl}/settings.testElectrum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      if (!res.ok) {
        const data = parseUnknown(ReconnectErrorSchema, await res.json().catch(() => null)).unwrapOr(null)
        const msg = data?.error.json?.message ?? data?.error.message ?? 'Connection failed'
        setTestResult({ ok: false, message: msg })
        return
      }

      setTestResult({ ok: true, message: 'Connection successful' })
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    try {
      const baseUrl = import.meta.env.VITE_BACKEND_API_URL ?? ''
      const { body } = await buildElectrumPayload()
      const res = await fetch(`${baseUrl}/settings.reconnectElectrum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      if (!res.ok) {
        const data = parseUnknown(ReconnectErrorSchema, await res.json().catch(() => null)).unwrapOr(null)
        throw new Error(data?.error.json?.message ?? data?.error.message ?? 'Failed to reconnect')
      }

      await Promise.all(
        ['electrum_host', 'electrum_port', 'electrum_protocol', 'tor_enabled'].map(async (key) =>
          queryClient.invalidateQueries({ queryKey: ['local-settings', key] }),
        ),
      )
      setIsDirty(false)
      setTestResult(null)
      refreshStatus()
      toast.success('Electrum server updated')
    } catch (err) {
      toast.error(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <VStack align="start" gap={5} w="full" maxW="480px">
      <VStack align="start" gap={1}>
        <Text as="h2" textStyle="text/md" fontWeight="semibold">
          Electrum Server
        </Text>
        <Text textStyle="text/sm" color="neutral.600">
          Configure your Bitcoin Electrum server connection. Use your own server for maximum privacy.
        </Text>
      </VStack>

      {/* Server preset selector */}
      <Stack gap={1} w="full">
        <FormLabel htmlFor="electrum-preset" textStyle="text/sm" mb={0}>
          Server Preset
        </FormLabel>
        <Select
          size="sm"
          id="electrum-preset"
          value={SERVER_PRESETS.find((p) => p.host === host && p.port === port) ? host : 'custom'}
          onChange={(e) => {
            const preset = SERVER_PRESETS.find((p) => p.host === e.target.value)
            if (preset) {
              setHost(preset.host)
              setPort(preset.port)
              setProtocol(preset.protocol)
              setTorEnabled(preset.tor)
              setIsDirty(true)
              setTestResult(null)
            }
          }}
          isDisabled={isLoading || isSaving || isTesting}
        >
          {SERVER_PRESETS.map((p) => (
            <option key={p.host} value={p.host}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom Server</option>
        </Select>
      </Stack>

      {/* Connection status banner */}
      {electrumStatus && (
        <HStack
          gap={2}
          px={3}
          py={2}
          w="full"
          borderRadius="md"
          bg={electrumStatus.connected ? 'green.50' : 'red.50'}
          align="start"
        >
          <Circle size="8px" bg={electrumStatus.connected ? 'green.500' : 'red.500'} flexShrink={0} mt="6px" />
          <VStack align="start" gap={0} minW={0}>
            <Text textStyle="text/sm" fontWeight="medium" color={electrumStatus.connected ? 'green.700' : 'red.700'}>
              {electrumStatus.connected ? 'Connected' : 'Disconnected'}
            </Text>
            <Text textStyle="text/xs" color={electrumStatus.connected ? 'green.600' : 'red.600'} wordBreak="break-all">
              {electrumStatus.host}:{electrumStatus.port} ({electrumStatus.protocol.toUpperCase()})
            </Text>
            {!electrumStatus.connected && (
              <Text textStyle="text/sm" color="red.700">
                {torFailedForSavedConnection
                  ? 'Your saved data is still on this device. Turn Tor on to try again, or choose a different server below.'
                  : 'Your saved data is still on this device. Check your connection or choose a server below, then use Save & Reconnect.'}
              </Text>
            )}
          </VStack>
        </HStack>
      )}

      {/* Host */}
      <Stack gap={1} w="full">
        <FormLabel htmlFor="electrum-host" textStyle="text/sm" mb={0}>
          Host
        </FormLabel>
        <Input
          size="sm"
          id="electrum-host"
          placeholder="electrum.blockstream.info"
          value={host}
          onChange={(e) => {
            setHost(e.target.value)
            setIsDirty(true)
            setTestResult(null)
          }}
          isDisabled={isLoading || isSaving || isTesting}
        />
      </Stack>

      {/* Port + Protocol side by side */}
      <HStack gap={3} w="full">
        <Stack gap={1} flex={1} minW={0}>
          <FormLabel htmlFor="electrum-port" textStyle="text/sm" mb={0}>
            Port
          </FormLabel>
          <Input
            size="sm"
            id="electrum-port"
            inputMode="numeric"
            placeholder="50002"
            value={port}
            onChange={(e) => {
              setPort(e.target.value)
              setIsDirty(true)
              setTestResult(null)
            }}
            isDisabled={isLoading || isSaving || isTesting}
          />
        </Stack>
        <Stack gap={1} w="120px" flexShrink={0}>
          <FormLabel htmlFor="electrum-protocol" textStyle="text/sm" mb={0}>
            Protocol
          </FormLabel>
          <Select
            size="sm"
            id="electrum-protocol"
            value={protocol}
            onChange={(e) => {
              const value = e.target.value
              if (value !== 'tcp' && value !== 'ssl') {
                return
              }
              setProtocol(value)
              setIsDirty(true)
              setTestResult(null)
            }}
            isDisabled={isLoading || isSaving || isTesting}
          >
            <option value="ssl">SSL</option>
            <option value="tcp">TCP</option>
          </Select>
        </Stack>
      </HStack>

      {/* Tor toggle */}
      <HStack w="full" justify="space-between" align="center">
        <VStack align="start" gap={0}>
          <FormLabel htmlFor="electrum-tor" textStyle="text/sm" mb={0}>
            Connect via Tor
          </FormLabel>
          <Text textStyle="text/xs" color="neutral.600">
            Routes Electrum requests through Tor. Exchange and price requests use your normal connection. Required for
            .onion addresses.
          </Text>
        </VStack>
        <Switch
          id="electrum-tor"
          colorScheme="green"
          isChecked={torEnabled}
          onChange={(e) => {
            handleTorChange(e.target.checked)
          }}
          isDisabled={isLoading || isSaving || isTesting}
          sx={
            torStarting
              ? { '.chakra-switch__track': { animation: `${torStartingFade} 3s ease-in-out infinite` } }
              : undefined
          }
        />
      </HStack>

      <TorStatusLine
        enabled={torEnabled}
        state={torState}
        progress={electrumStatus?.tor?.progress}
        failure={torFailure}
        readyNotice={torReadyNotice}
        slow={torStartedAt !== null && Date.now() - torStartedAt > TOR_SLOW_START_MS}
      />

      {/* Test result banner */}
      {testResult && (
        <HStack gap={2} px={3} py={2} w="full" borderRadius="md" bg={testResult.ok ? 'green.50' : 'red.50'}>
          <Circle size="8px" bg={testResult.ok ? 'green.500' : 'red.500'} flexShrink={0} />
          <Text
            as="output"
            textStyle="text/sm"
            overflowWrap="anywhere"
            minW={0}
            color={testResult.ok ? 'green.700' : 'red.700'}
          >
            {testResult.message}
          </Text>
        </HStack>
      )}

      {/* Action buttons */}
      <ButtonGroup size="sm" gap={2} flexWrap="wrap">
        <Button
          variant="outline"
          onClick={() => {
            if (leavingTor) {
              setDirectConfirmation('test')
            } else {
              void handleTest()
            }
          }}
          isLoading={isTesting}
          loadingText="Testing..."
          isDisabled={!host.trim() || !port.trim() || isLoading || isSaving || torStarting}
        >
          Test Connection
        </Button>
        <Button
          colorScheme="green"
          onClick={() => {
            if (leavingTor) {
              setDirectConfirmation('save')
            } else {
              void handleSave()
            }
          }}
          isLoading={isSaving}
          isDisabled={(!isDirty && electrumStatus?.connected !== false) || isLoading || isTesting || torStarting}
        >
          Save & Reconnect
        </Button>
      </ButtonGroup>

      <Modal
        isOpen={directConfirmation !== null}
        onClose={() => {
          setDirectConfirmation(null)
        }}
        isCentered
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Connect without Tor?</ModalHeader>
          <ModalBody>
            <Text textStyle="text/sm" color="neutral.700">
              {directConfirmation === 'save'
                ? 'The server will see your IP address and the addresses you look up.'
                : 'The server will see your IP address.'}
            </Text>
          </ModalBody>
          <ModalFooter gap={2}>
            <Button
              variant="outline"
              flex={1}
              onClick={() => {
                setDirectConfirmation(null)
              }}
            >
              Cancel
            </Button>
            <Button
              flex={1}
              onClick={() => {
                const action = directConfirmation
                setDirectConfirmation(null)
                void (action === 'save' ? handleSave() : handleTest())
              }}
            >
              Connect without Tor
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}

function TorStatusLine({
  enabled,
  state,
  progress,
  failure,
  readyNotice,
  slow,
}: {
  enabled: boolean
  state: string | undefined
  progress: number | undefined
  failure: string | null
  readyNotice: 'shown' | 'fading' | null
  slow: boolean
}): JSX.Element | null {
  if (failure !== null) {
    return (
      <HStack as="output" gap={2} color="red.600">
        <CircleAlertIcon size={16} aria-hidden />
        <Text textStyle="text/sm">{failure}</Text>
      </HStack>
    )
  }
  if (!enabled) {
    return null
  }
  if (state === 'ready' && readyNotice !== null) {
    return (
      <HStack
        as="output"
        gap={2}
        color="green.600"
        opacity={readyNotice === 'fading' ? 0 : 1}
        transition={`opacity ${TOR_READY_FADE_MS}ms ease-out`}
      >
        <CircleCheckIcon size={16} aria-hidden />
        <Text textStyle="text/sm">Tor ready</Text>
      </HStack>
    )
  }
  if (state === 'starting') {
    const percent = Math.round(progress ?? 0)
    return (
      <Stack as="output" gap={2} w="full">
        <Text textStyle="text/sm" color="neutral.600">
          {`Starting Tor… ${percent}%${slow ? '. This can take up to two minutes.' : ''}`}
        </Text>
        <Box h="3px" w="full" bg="neutral.100" borderRadius="full" overflow="hidden">
          <Box h="full" w={`${percent}%`} bg="green.500" transition="width 0.3s" />
        </Box>
      </Stack>
    )
  }
  return null
}
