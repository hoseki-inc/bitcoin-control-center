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
  Radio,
  RadioGroup,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  VStack,
} from '@chakra-ui/react'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useBitcoinDisplay } from '../../hooks/use-bitcoin-display'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { bitcoinDisplayUnit, formatBitcoin } from '../../lib/bitcoin-display'
import { isDesktop } from '../../mode'

export function SettingsPage(): JSX.Element {
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
                onChange={(event) => setDraftName(event.target.value)}
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
        <BitcoinDisplaySettings />
        {isDesktop && <ElectrumSettings />}
      </Stack>
    </Box>
  )
}

const DISPLAY_OPTIONS = [
  { value: 'symbol', label: 'Bitcoin symbol' },
  { value: 'sats', label: 'Sats' },
  { value: 'btc', label: 'BTC' },
] as const

function BitcoinDisplaySettings(): JSX.Element {
  const { unit, saveAsync, isSaving, isLoading, isError } = useBitcoinDisplay()
  const handleChange = async (value: string): Promise<void> => {
    try {
      await saveAsync(bitcoinDisplayUnit(value))
      toast.success('Bitcoin display updated')
    } catch {
      toast.error('Could not save your display preference. Please try again.')
    }
  }

  return (
    <Box as="section" aria-labelledby="bitcoin-display-heading">
      <Text as="h2" id="bitcoin-display-heading" textStyle="text/md" fontWeight="semibold" color="neutral.900">
        Bitcoin display
      </Text>
      <Text mt={2} textStyle="text/sm" color="neutral.600" id="bitcoin-display-description">
        Choose how Bitcoin amounts appear in the app. The Bitcoin symbol and sats both show whole satoshi amounts. Each
        preview shows the same 2.1 BTC.
      </Text>
      <RadioGroup
        value={unit}
        onChange={(value) => void handleChange(value)}
        mt={5}
        aria-labelledby="bitcoin-display-heading"
        aria-describedby="bitcoin-display-description"
        isDisabled={isLoading || isSaving || isError}
      >
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
          {DISPLAY_OPTIONS.map((option) => (
            <Box
              as="label"
              key={option.value}
              p={4}
              border="1px solid"
              borderRadius="panel"
              borderColor={unit === option.value ? 'neutral.900' : 'neutral.200'}
              bg={unit === option.value ? 'neutral.50' : 'shades.0'}
              cursor={isLoading || isSaving || isError ? 'default' : 'pointer'}
              transition="border-color 150ms ease, background-color 150ms ease"
              _hover={{ borderColor: 'neutral.500' }}
              _focusWithin={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' }}
            >
              <HStack justify="space-between" mb={5}>
                <Text textStyle="text/sm" fontWeight="medium">
                  {option.label}
                </Text>
                <Radio as="span" value={option.value} colorScheme="gray" aria-label={option.label} />
              </HStack>
              <Text
                textStyle="text/lg"
                fontWeight="semibold"
                color="neutral.900"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatBitcoin('2.1', option.value)}
              </Text>
            </Box>
          ))}
        </SimpleGrid>
      </RadioGroup>
      <Text mt={3} textStyle="text/xs" color={isError ? 'error.700' : 'neutral.600'} role="status">
        {isError
          ? 'Could not load your preference. Refresh to try again.'
          : isLoading
            ? 'Loading preference…'
            : isSaving
              ? 'Saving preference…'
              : 'Saved automatically on this Control Center.'}
      </Text>
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
          ...(torEnabled ? { proxyHost: '127.0.0.1', proxyPort: 9050 } : {}),
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
      saveHost(host.trim())
      savePort(port.trim())
      saveProtocol(protocol)
      saveTorEnabled(String(torEnabled))

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
        <Stack gap={1} flex={1}>
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
        <Stack gap={1} w="120px">
          <FormLabel htmlFor="electrum-protocol" textStyle="text/sm" mb={0}>
            Protocol
          </FormLabel>
          <Select
            size="sm"
            id="electrum-protocol"
            value={protocol}
            onChange={(e) => {
              setProtocol(e.target.value as 'tcp' | 'ssl')
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
        <HStack
          role="status"
          gap={2}
          px={3}
          py={2}
          w="full"
          borderRadius="md"
          bg={testResult.ok ? 'green.50' : 'red.50'}
        >
          <Circle size="8px" bg={testResult.ok ? 'green.500' : 'red.500'} flexShrink={0} />
          <Text textStyle="text/sm" overflowWrap="anywhere" minW={0} color={testResult.ok ? 'green.700' : 'red.700'}>
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
