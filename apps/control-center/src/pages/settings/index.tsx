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
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  VStack,
} from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { useCallback, useEffect, useState } from 'react'
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
        <Stack align="start" gap={2}>
          <Text as="h2" textStyle="text/md" fontWeight="semibold">
            Getting Started
          </Text>
          <Text textStyle="text/sm" color="neutral.600">
            Learn how to track your Bitcoin with Control Center.
          </Text>
          <Button as="a" href="/getting-started" variant="outline" mt={2}>
            View Introduction
          </Button>
        </Stack>
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

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10_000)
    return (): void => {
      clearInterval(interval)
    }
  }, [refresh])

  return { status, refresh }
}

function ElectrumSettings(): JSX.Element {
  const { status: electrumStatus, refresh: refreshStatus } = useElectrumStatus()
  const { data: savedHost, isLoading: hostLoading, save: saveHost } = useLocalSetting('electrum_host')
  const { data: savedPort, isLoading: portLoading, save: savePort } = useLocalSetting('electrum_port')
  const { data: savedProtocol, isLoading: protocolLoading, save: saveProtocol } = useLocalSetting('electrum_protocol')
  const { data: savedTorEnabled, isLoading: torLoading, save: saveTorEnabled } = useLocalSetting('tor_enabled')

  const isLoading = hostLoading || portLoading || protocolLoading || torLoading

  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [protocol, setProtocol] = useState<'tcp' | 'ssl'>('ssl')
  const [torEnabled, setTorEnabled] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

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
    }
    if (torEnabled) {
      payload.proxyHost = '127.0.0.1'
      payload.proxyPort = 9050
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
      saveHost(host.trim())
      savePort(port.trim())
      saveProtocol(protocol)
      saveTorEnabled(String(torEnabled))

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

      setIsDirty(false)
      setTestResult(null)
      setTimeout(refreshStatus, 1000)
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
          isDisabled={isLoading}
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
          isDisabled={isLoading}
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
            isDisabled={isLoading}
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
            isDisabled={isLoading}
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
            Route through bundled Tor proxy. Required for .onion addresses.
          </Text>
        </VStack>
        <Switch
          id="electrum-tor"
          isChecked={torEnabled}
          onChange={(e) => {
            setTorEnabled(e.target.checked)
            setIsDirty(true)
            setTestResult(null)
          }}
          isDisabled={isLoading}
        />
      </HStack>

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
          onClick={() => void handleTest()}
          isLoading={isTesting}
          loadingText="Testing..."
          isDisabled={!host.trim() || !port.trim() || isLoading}
        >
          Test Connection
        </Button>
        <Button
          colorScheme="green"
          onClick={() => void handleSave()}
          isLoading={isSaving}
          isDisabled={!isDirty || isLoading}
        >
          Save & Reconnect
        </Button>
      </ButtonGroup>
    </VStack>
  )
}
