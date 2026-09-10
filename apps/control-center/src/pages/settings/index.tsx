import {
  Box,
  Button,
  ButtonGroup,
  Circle,
  Divider,
  HStack,
  Heading,
  Input,
  Select,
  Stack,
  Switch,
  Text,
  VStack,
} from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { isDesktop } from '../../mode'

export function SettingsPage(): JSX.Element {
  const { data: savedName, isLoading, save, isSaving } = useLocalSetting('user_name')

  const [name, setName] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (savedName && !isDirty) {
      setName(savedName)
    }
  }, [savedName, isDirty])

  const handleSave = (): void => {
    save(name.trim())
    setIsDirty(false)
    toast.success('Name saved')
  }

  return (
    <Box p={6}>
      <VStack align="start" gap={8}>
        <VStack align="start" gap={1}>
          <Heading size="lg">Settings</Heading>
          <Text textStyle="text/md" color="neutral.600">
            App preferences and personal information.
          </Text>
        </VStack>

        <Stack gap={2} w="full" maxW="400px">
          <Text textStyle="label/sm" fontWeight="medium">
            Your Name
          </Text>
          <Text textStyle="text/sm" color="neutral.600">
            This name will appear on your generated statements.
          </Text>
          <Input
            placeholder="Enter your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setIsDirty(true)
            }}
            isDisabled={isLoading}
          />
          <Button
            size="sm"
            colorScheme="green"
            alignSelf="flex-start"
            onClick={handleSave}
            isLoading={isSaving}
            isDisabled={!isDirty || name.trim() === (savedName ?? '')}
          >
            Save
          </Button>
        </Stack>

        {isDesktop && (
          <>
            <Divider />
            <ElectrumSettings />
          </>
        )}
      </VStack>
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

interface ElectrumStatus {
  connected: boolean
  host: string
  port: number
  protocol: string
  tor?: { state: 'stopped' | 'starting' | 'ready' | 'failed' | 'unavailable'; message?: string }
}

function useElectrumStatus(): { status: ElectrumStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<ElectrumStatus | null>(null)

  const refresh = useCallback((): void => {
    const baseUrl = import.meta.env['VITE_BACKEND_API_URL'] ?? ''
    void fetch(`${baseUrl}/settings.electrumStatus`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // tRPC wraps response in result.data.json (superjson) or result.data
        const payload = data?.result?.data?.json ?? data?.result?.data
        if (payload?.host) setStatus(payload as ElectrumStatus)
      })
      .catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10_000)
    return (): void => clearInterval(interval)
  }, [refresh])

  return { status, refresh }
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

  useEffect(() => {
    if (!isDirty) {
      setHost(savedHost ?? 'electrum.blockstream.info')
      setPort(savedPort ?? '50002')
      setProtocol((savedProtocol as 'tcp' | 'ssl') ?? 'ssl')
      setTorEnabled(savedTorEnabled === 'true')
    }
  }, [savedHost, savedPort, savedProtocol, savedTorEnabled, isDirty])

  const buildElectrumPayload = async (): Promise<{ body: string }> => {
    const superjson = (await import('superjson')).default
    return {
      body: JSON.stringify(
        superjson.serialize({
          host: host.trim(),
          port: Number(port.trim()),
          protocol,
          torEnabled,
        }),
      ),
    }
  }

  const handleTest = async (): Promise<void> => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const baseUrl = import.meta.env['VITE_BACKEND_API_URL'] ?? ''
      const { body } = await buildElectrumPayload()
      const res = await fetch(`${baseUrl}/settings.testElectrum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = data?.error?.json?.message ?? data?.error?.message ?? 'Connection failed'
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
      const baseUrl = import.meta.env['VITE_BACKEND_API_URL'] ?? ''
      const { body } = await buildElectrumPayload()
      const res = await fetch(`${baseUrl}/settings.reconnectElectrum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error?.json?.message ?? data?.error?.message ?? 'Failed to reconnect')
      }

      await Promise.all(
        ['electrum_host', 'electrum_port', 'electrum_protocol', 'tor_enabled'].map((key) =>
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
        <Text textStyle="label/md" fontWeight="semibold">
          Electrum Server
        </Text>
        <Text textStyle="text/sm" color="neutral.600">
          Configure your Bitcoin Electrum server connection. Use your own server for maximum privacy.
        </Text>
      </VStack>

      {/* Server preset selector */}
      <Stack gap={1} w="full">
        <Text textStyle="label/sm" fontWeight="medium">
          Server Preset
        </Text>
        <Select
          size="sm"
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
          <VStack align="start" gap={0}>
            <Text textStyle="text/sm" fontWeight="medium" color={electrumStatus.connected ? 'green.700' : 'red.700'}>
              {electrumStatus.connected ? 'Connected' : 'Disconnected'}
            </Text>
            <Text textStyle="text/xs" color={electrumStatus.connected ? 'green.600' : 'red.600'} wordBreak="break-all">
              {electrumStatus.host}:{electrumStatus.port} ({electrumStatus.protocol.toUpperCase()})
            </Text>
            {!electrumStatus.connected && (
              <Text textStyle="text/sm" color="red.700">
                Your saved data is still on this device. Check your connection or choose a server below, then use Save
                &amp; Reconnect.
              </Text>
            )}
          </VStack>
        </HStack>
      )}

      {/* Host */}
      <Stack gap={1} w="full">
        <Text textStyle="label/sm" fontWeight="medium">
          Host
        </Text>
        <Input
          size="sm"
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
        <Stack gap={1} flex={1}>
          <Text textStyle="label/sm" fontWeight="medium">
            Port
          </Text>
          <Input
            size="sm"
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
        <Stack gap={1} w="120px">
          <Text textStyle="label/sm" fontWeight="medium">
            Protocol
          </Text>
          <Select
            size="sm"
            value={protocol}
            onChange={(e) => {
              setProtocol(e.target.value as 'tcp' | 'ssl')
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

      {electrumStatus?.tor && (
        <Text
          textStyle="body/sm"
          color={electrumStatus.tor.state === 'failed' ? 'red.500' : 'text.secondary'}
          role="status"
        >
          {electrumStatus.tor.state === 'ready'
            ? 'Tor is ready.'
            : electrumStatus.tor.state === 'starting'
              ? 'Tor is connecting. This can take up to two minutes.'
              : (electrumStatus.tor.message ?? 'Tor starts when you test or save a Tor connection.')}
        </Text>
      )}

      {/* Tor toggle */}
      <HStack w="full" justify="space-between" align="center">
        <VStack align="start" gap={0}>
          <Text textStyle="label/sm" fontWeight="medium">
            Connect via Tor
          </Text>
          <Text textStyle="text/xs" color="neutral.600">
            Routes Electrum requests through Tor. Exchange and price requests use your normal connection. Required for
            .onion addresses.
          </Text>
        </VStack>
        <Switch
          isChecked={torEnabled}
          onChange={(e) => {
            setTorEnabled(e.target.checked)
            setIsDirty(true)
            setTestResult(null)
          }}
          isDisabled={isLoading || isSaving || isTesting}
        />
      </HStack>

      {/* Test result banner */}
      {testResult && (
        <HStack gap={2} px={3} py={2} w="full" borderRadius="md" bg={testResult.ok ? 'green.50' : 'red.50'}>
          <Circle size="8px" bg={testResult.ok ? 'green.500' : 'red.500'} flexShrink={0} />
          <Text textStyle="text/sm" color={testResult.ok ? 'green.700' : 'red.700'}>
            {testResult.message}
          </Text>
        </HStack>
      )}

      {/* Action buttons */}
      <ButtonGroup size="sm" gap={2}>
        <Button
          variant="outline"
          onClick={() => void handleTest()}
          isLoading={isTesting}
          loadingText="Testing..."
          isDisabled={!host.trim() || !port.trim() || isLoading || isSaving}
        >
          Test Connection
        </Button>
        <Button
          colorScheme="green"
          onClick={() => void handleSave()}
          isLoading={isSaving}
          isDisabled={(!isDirty && electrumStatus?.connected !== false) || isLoading || isTesting}
        >
          Save & Reconnect
        </Button>
      </ButtonGroup>
    </VStack>
  )
}
