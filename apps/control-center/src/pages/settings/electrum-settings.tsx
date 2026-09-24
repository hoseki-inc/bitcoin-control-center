import {
  Box,
  Button,
  Collapse,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react'
import { SegmentedControl } from '@hoseki/packages/ui/design-system/forms/segmented-control'
import { useReducedMotion } from 'framer-motion'
import { Server } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '../../trpc/base'
import { type RouterOutput } from '../../trpc/index'
import { SettingsRow } from './settings-rows'

type ElectrumStatus = RouterOutput['settings']['electrumStatus']
type Protocol = 'ssl' | 'tcp'
type Choice = 'blockstream' | 'mempool' | 'custom'

interface Endpoint {
  host: string
  port: string
  protocol: Protocol
}

const PRESETS: Record<Exclude<Choice, 'custom'>, Endpoint & { name: string }> = {
  blockstream: { name: 'Blockstream', host: 'electrum.blockstream.info', port: '50002', protocol: 'ssl' },
  mempool: { name: 'Mempool', host: 'electrum.mempool.space', port: '50002', protocol: 'ssl' },
}

const CHOICES: ReadonlyArray<{ value: Choice; label: string }> = [
  { value: 'blockstream', label: 'Blockstream' },
  { value: 'mempool', label: 'Mempool' },
  { value: 'custom', label: 'Your own' },
]

const PROTOCOLS: ReadonlyArray<{ value: Protocol; label: string }> = [
  { value: 'ssl', label: 'SSL' },
  { value: 'tcp', label: 'TCP' },
]

/** An Electrum server as `host:port`, with IPv6 hosts bracketed. */
export function formatServer({ host, port }: { host: string; port: number | string }): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}

function presetFor(status: ElectrumStatus): Choice {
  const match = (Object.keys(PRESETS) as Array<keyof typeof PRESETS>).find((key) => {
    const preset = PRESETS[key]
    return preset.host === status.host && preset.port === String(status.port) && preset.protocol === status.protocol
  })
  return match ?? 'custom'
}

function parsePort(value: string): number | null {
  const port = Number(value.trim())
  return /^\d+$/.test(value.trim()) && port >= 1 && port <= 65_535 ? port : null
}

/**
 * The Electrum server Control Center reads the blockchain from, desktop app only.
 * The row shows the live connection; Change opens an editor underneath it, and the
 * new server is used and saved only once it answers.
 */
export function ElectrumRow({ tone }: { tone: number }): JSX.Element {
  const status = trpc.settings.electrumStatus.useQuery(undefined, { refetchInterval: 10_000 })
  const [editing, setEditing] = useState(false)
  const changeRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = useReducedMotion() === true

  const close = (): void => {
    setEditing(false)
    // Return focus to the control that opened the editor once it is back.
    requestAnimationFrame(() => changeRef.current?.focus())
  }

  return (
    <>
      <SettingsRow
        icon={Server}
        tone={tone}
        title="Electrum server"
        titleId="electrum-heading"
        description={<ConnectionSummary status={status.data} isError={status.isError} />}
        control={
          editing ? undefined : (
            <Button
              ref={changeRef}
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              isDisabled={status.data === undefined}
            >
              Change
            </Button>
          )
        }
      />
      {status.data !== undefined && (
        <Collapse
          in={editing}
          animateOpacity
          unmountOnExit
          // The row is last on the page, so bring the whole editor above the dock once open.
          onAnimationComplete={(definition) => {
            if (definition !== 'enter') return
            document
              .getElementById('electrum-editor')
              ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
          }}
        >
          <ElectrumEditor status={status.data} onDone={close} />
        </Collapse>
      )}
    </>
  )
}

function ConnectionSummary({ status, isError }: { status: ElectrumStatus | undefined; isError: boolean }): JSX.Element {
  if (status === undefined) {
    return <>{isError ? 'Couldn’t load the connection status.' : 'Checking connection…'}</>
  }
  const server = formatServer(status)
  const tone = status.connected ? 'status.success.solid' : 'status.error.solid'
  return (
    <Box as="span" role="status" display="inline-flex" alignItems="baseline" gap={1.5} minW={0} maxW="100%">
      <Box as="span" boxSize="7px" flexShrink={0} borderRadius="full" bg={tone} transform="translateY(-1px)" />
      <Box as="span" minW={0} overflowWrap="anywhere">
        {status.connected ? `Connected to ${server}` : `Can’t reach ${server}. Retrying…`}
        {status.tor && ' · through Tor'}
      </Box>
    </Box>
  )
}

function ElectrumEditor({ status, onDone }: { status: ElectrumStatus; onDone: () => void }): JSX.Element {
  const utils = trpc.useUtils()
  const reconnect = trpc.settings.reconnectElectrum.useMutation()
  const formRef = useRef<HTMLFormElement>(null)

  const initialChoice = presetFor(status)
  const [choice, setChoice] = useState<Choice>(initialChoice)
  // Typed values survive switching to a preset and back.
  const [custom, setCustom] = useState<Endpoint>(
    initialChoice === 'custom'
      ? { host: status.host, port: String(status.port), protocol: status.protocol }
      : { host: '', port: '50001', protocol: 'tcp' },
  )
  const [tor, setTor] = useState(status.tor)

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
  }, [])

  const endpoint: Endpoint = choice === 'custom' ? custom : PRESETS[choice]
  const host = endpoint.host.trim()
  const port = parsePort(endpoint.port)
  const isOnion = host.endsWith('.onion')
  const problem =
    choice === 'custom' && endpoint.port.trim() !== '' && port === null
      ? 'Enter a port between 1 and 65535.'
      : isOnion && !tor
        ? 'Onion addresses can only be reached through Tor.'
        : null
  const canConnect = host !== '' && port !== null && problem === null && !reconnect.isLoading

  const updateCustom = (patch: Partial<Endpoint>): void => {
    setCustom((current) => ({ ...current, ...patch }))
    reconnect.reset()
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canConnect || port === null) return
    try {
      const next = await reconnect.mutateAsync({ host, port, protocol: endpoint.protocol, tor })
      utils.settings.electrumStatus.setData(undefined, next)
      toast.success(`Connected to ${formatServer(next)}`)
      onDone()
    } catch {
      // The message is shown in the form.
    }
  }

  return (
    <Box
      as="form"
      id="electrum-editor"
      ref={formRef}
      aria-labelledby="electrum-heading"
      onSubmit={(event: FormEvent) => void handleSubmit(event)}
      px={{ base: 4, md: 5 }}
      py={5}
      scrollMarginBottom="calc(var(--sheet-footer-offset, 16px) + 16px)"
    >
      <Stack spacing={5}>
        <Stack spacing={2}>
          <Text id="electrum-server-label" textStyle="text/sm" fontWeight="semibold">
            Server
          </Text>
          <SegmentedControl
            name="electrum-server"
            value={choice}
            options={CHOICES}
            onChange={(value) => {
              setChoice(value)
              reconnect.reset()
            }}
            ariaLabel="Server"
            ariaDescribedBy="electrum-server-hint"
            fullWidth
          />
          <Text id="electrum-server-hint" textStyle="text/xs" color="text.secondary">
            {choice === 'custom'
              ? 'Your own node answers only to you, so your addresses stay private.'
              : `${PRESETS[choice].name}’s public server at ${formatServer(PRESETS[choice])}. It can see which addresses you look up.`}
          </Text>
        </Stack>

        {choice === 'custom' && (
          <Stack spacing={5}>
            <Flex gap={3} direction={{ base: 'column', sm: 'row' }}>
              <FormControl flex={1}>
                <FormLabel
                  htmlFor="electrum-host"
                  textStyle="text/sm"
                  fontWeight="semibold"
                  color="text.primary"
                  mb={1.5}
                >
                  Address
                </FormLabel>
                <Input
                  id="electrum-host"
                  size="sm"
                  placeholder="umbrel.local or an .onion address"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={custom.host}
                  onChange={(event) => updateCustom({ host: event.target.value })}
                />
              </FormControl>
              <FormControl w={{ base: 'full', sm: '112px' }}>
                <FormLabel
                  htmlFor="electrum-port"
                  textStyle="text/sm"
                  fontWeight="semibold"
                  color="text.primary"
                  mb={1.5}
                >
                  Port
                </FormLabel>
                <Input
                  id="electrum-port"
                  size="sm"
                  inputMode="numeric"
                  placeholder="50001"
                  value={custom.port}
                  onChange={(event) => updateCustom({ port: event.target.value })}
                />
              </FormControl>
            </Flex>
            <Flex justify="space-between" align="center" gap={4} wrap="wrap">
              <Stack spacing={0.5}>
                <Text id="electrum-protocol-label" textStyle="text/sm" fontWeight="semibold">
                  Encryption
                </Text>
                <Text id="electrum-protocol-hint" textStyle="text/xs" color="text.secondary">
                  Use SSL if your server offers it. TCP is fine on your own network or through Tor.
                </Text>
              </Stack>
              <SegmentedControl
                name="electrum-protocol"
                size="sm"
                value={custom.protocol}
                options={PROTOCOLS}
                onChange={(protocol) => updateCustom({ protocol })}
                ariaLabel="Encryption"
                ariaDescribedBy="electrum-protocol-hint"
              />
            </Flex>
          </Stack>
        )}

        <Flex justify="space-between" align="center" gap={4}>
          <Stack spacing={0.5}>
            <FormLabel htmlFor="electrum-tor" textStyle="text/sm" fontWeight="semibold" color="text.primary" mb={0}>
              Connect through Tor
            </FormLabel>
            <Text id="electrum-tor-hint" textStyle="text/xs" color="text.secondary">
              {status.torAvailable
                ? 'Hides your IP address from the server. Needed for .onion addresses.'
                : 'Tor is only available in the desktop app.'}
            </Text>
          </Stack>
          <Switch
            id="electrum-tor"
            size="lg"
            isChecked={tor}
            isDisabled={!status.torAvailable && !tor}
            aria-describedby="electrum-tor-hint"
            onChange={(event) => {
              setTor(event.target.checked)
              reconnect.reset()
            }}
          />
        </Flex>

        {(problem !== null || reconnect.error !== null) && (
          <Text role="alert" textStyle="text/sm" color="status.error.fg" overflowWrap="anywhere">
            {problem ?? `Couldn’t connect. ${reconnect.error?.message ?? ''}`}
          </Text>
        )}

        <HStack justify="flex-end" spacing={2}>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            isDisabled={!canConnect}
            isLoading={reconnect.isLoading}
            loadingText="Connecting"
          >
            Connect
          </Button>
        </HStack>
      </Stack>
    </Box>
  )
}
