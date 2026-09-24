import {
  Box,
  Button,
  ButtonGroup,
  Circle,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Select,
  Stack,
  Switch,
  Text,
  VStack,
} from '@chakra-ui/react'
import { SegmentedControl } from '@hoseki/packages/ui/design-system/forms/segmented-control'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { Bitcoin, ChevronRight, EyeOff, Rocket, SunMoon, UserRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { type AppearancePreference, useAppearance } from '../../hooks/use-appearance'
import { useBitcoinDisplay } from '../../hooks/use-bitcoin-display'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { usePrivacy } from '../../hooks/use-privacy'
import { bitcoinDisplayUnit, formatBitcoin } from '../../lib/bitcoin-display'
import { isDesktop } from '../../mode'
import { SettingsGroup, SettingsRow } from './settings-rows'
import { WallpaperRow } from './wallpaper-settings'

export function SettingsPage(): JSX.Element {
  return (
    <Box py={{ base: 6, md: 10 }} maxW="880px">
      <PageHeading title="Settings" description="App preferences and personal information." />
      <Stack mt={{ base: 8, md: 10 }} spacing={7}>
        <SettingsGroup label="You">
          <NameRow tone={0} />
        </SettingsGroup>
        <SettingsGroup label="Look and feel">
          <AppearanceRow tone={1} />
          <WallpaperRow tone={2} />
          <PrivacyRow tone={3} />
        </SettingsGroup>
        <SettingsGroup label="Bitcoin">
          <BitcoinDisplayRow tone={4} />
        </SettingsGroup>
        <SettingsGroup label="Help">
          <Box
            as={Link}
            to="/getting-started"
            display="block"
            transition="background-color 150ms"
            _hover={{ bg: 'var(--edge-bg-hover)' }}
            _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '-2px' }}
          >
            <SettingsRow
              icon={Rocket}
              tone={5}
              title="Getting started"
              description="Learn how to track your Bitcoin with Control Center."
              control={<ChevronRight size={18} color="var(--hoseki-colors-text-tertiary)" aria-hidden />}
            />
          </Box>
        </SettingsGroup>
        {isDesktop && (
          <SettingsGroup label="Connection">
            <Box px={{ base: 4, md: 5 }} py={5}>
              <ElectrumSettings />
            </Box>
          </SettingsGroup>
        )}
      </Stack>
    </Box>
  )
}

function NameRow({ tone }: { tone: number }): JSX.Element {
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
    <SettingsRow
      icon={UserRound}
      tone={tone}
      title={<label htmlFor="user-name">Your name</label>}
      description="Used in your greeting and on generated statements."
      descriptionId="user-name-description"
      control={
        <Box
          as="form"
          display="flex"
          gap={2}
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <FormControl isDisabled={isLoading || isSaving || isError} w={{ base: 'full', md: '240px' }}>
            <Input
              id="user-name"
              autoComplete="name"
              aria-describedby="user-name-description"
              maxLength={200}
              placeholder="Enter your name"
              size="sm"
              value={name}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </FormControl>
          <Button
            type="submit"
            size="sm"
            isLoading={isSaving}
            loadingText="Saving"
            isDisabled={isLoading || isError || name.trim() === (savedName ?? '')}
          >
            Save name
          </Button>
        </Box>
      }
      footer={
        isError ? (
          <Text role="alert" textStyle="text/sm" color="status.error.fg">
            Could not load your name. Refresh to try again.
          </Text>
        ) : undefined
      }
    />
  )
}

const APPEARANCE_OPTIONS: ReadonlyArray<{ value: AppearancePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function AppearanceRow({ tone }: { tone: number }): JSX.Element {
  const { preference, setPreference } = useAppearance()
  return (
    <SettingsRow
      icon={SunMoon}
      tone={tone}
      title="Appearance"
      titleId="appearance-heading"
      description="Light or dark glass, or follow your device."
      descriptionId="appearance-description"
      control={
        <SegmentedControl
          name="appearance"
          value={preference}
          options={APPEARANCE_OPTIONS}
          onChange={setPreference}
          ariaLabel="Appearance"
          ariaDescribedBy="appearance-description"
        />
      }
    />
  )
}

function PrivacyRow({ tone }: { tone: number }): JSX.Element {
  const { hidden, toggle } = usePrivacy()
  return (
    <SettingsRow
      icon={EyeOff}
      tone={tone}
      title={<label htmlFor="hide-balances">Hide balances</label>}
      description="Mask amounts everywhere, for screen sharing or working in public. Also in the top-right corner."
      control={<Switch id="hide-balances" isChecked={hidden} onChange={toggle} size="lg" />}
    />
  )
}

const DISPLAY_OPTIONS = [
  { value: 'symbol', label: 'Bitcoin symbol' },
  { value: 'sats', label: 'Sats' },
  { value: 'btc', label: 'BTC' },
] as const

function BitcoinDisplayRow({ tone }: { tone: number }): JSX.Element {
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
    <SettingsRow
      icon={Bitcoin}
      tone={tone}
      title="Bitcoin display"
      titleId="bitcoin-display-heading"
      description="The Bitcoin symbol and sats both show whole satoshi amounts. Each option previews 2.1 BTC."
      descriptionId="bitcoin-display-description"
      footer={
        <Stack spacing={3}>
          <SegmentedControl
            name="bitcoin-display"
            value={unit}
            onChange={(value) => void handleChange(value)}
            ariaLabel="Bitcoin display"
            ariaDescribedBy="bitcoin-display-description"
            isDisabled={isLoading || isSaving || isError}
            fullWidth
            options={DISPLAY_OPTIONS.map((option) => ({
              value: option.value,
              ariaLabel: option.label,
              label: (
                <Box as="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatBitcoin('2.1', option.value)}
                </Box>
              ),
            }))}
          />
          <Text textStyle="text/xs" color={isError ? 'status.error.fg' : 'text.secondary'} role="status">
            {isError
              ? 'Could not load your preference. Refresh to try again.'
              : isLoading
                ? 'Loading preference…'
                : isSaving
                  ? 'Saving preference…'
                  : 'Saved automatically on this Control Center.'}
          </Text>
        </Stack>
      }
    />
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
        <Text textStyle="text/sm" color="text.secondary">
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
          bg={electrumStatus.connected ? 'status.success.bg' : 'status.error.bg'}
          align="start"
        >
          <Circle
            size="8px"
            bg={electrumStatus.connected ? 'status.success.solid' : 'status.error.solid'}
            flexShrink={0}
            mt="6px"
          />
          <VStack align="start" gap={0} minW={0}>
            <Text
              textStyle="text/sm"
              fontWeight="medium"
              color={electrumStatus.connected ? 'status.success.fg' : 'status.error.fg'}
            >
              {electrumStatus.connected ? 'Connected' : 'Disconnected'}
            </Text>
            <Text
              textStyle="text/xs"
              color={electrumStatus.connected ? 'status.success.fg' : 'status.error.fg'}
              wordBreak="break-all"
            >
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
          <Text textStyle="text/xs" color="text.secondary">
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
          bg={testResult.ok ? 'status.success.bg' : 'status.error.bg'}
        >
          <Circle size="8px" bg={testResult.ok ? 'status.success.solid' : 'status.error.solid'} flexShrink={0} />
          <Text
            textStyle="text/sm"
            overflowWrap="anywhere"
            minW={0}
            color={testResult.ok ? 'status.success.fg' : 'status.error.fg'}
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
