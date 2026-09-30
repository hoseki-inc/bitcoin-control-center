import {
  Box,
  Button,
  ButtonGroup,
  Checkbox,
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
  Spinner,
  Stack,
  Switch,
  Text,
  VStack,
  VisuallyHidden,
  keyframes,
  useToken,
} from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { isDesktop } from '../../mode'
import { type RouterInput, type RouterOutput, baseTrpc, transformer, trpc } from '../../trpc'
import {
  ConnectionPicker,
  type ConnectionSelection,
  DeleteConnectionDialog,
  ErrorResponseSchema,
  SAVED_CONNECTIONS_QUERY_KEY,
  type SavedConnection,
  connectConnection,
  createConnection,
  deleteConnection,
  renameConnection,
  useSavedConnections,
} from './saved-connections'

type ElectrumStatusState = { status: ElectrumStatus | null; refresh: () => void }

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
        <PriceSourceSettings />
        {desktop && <ElectrumSettings />}
      </Stack>
    </Box>
  )
}

// ─── Confirmations ───────────────────────────────────────────────────────────

type FadingNotice = 'shown' | 'fading' | null

// A confirmation such as "Tor ready" stays long enough to read, then fades.
const NOTICE_VISIBLE_MS = 3000
const NOTICE_FADE_MS = 600

function useFadingNotice(): [FadingNotice, (notice: 'shown' | null) => void] {
  const [notice, setNotice] = useState<FadingNotice>(null)
  // Timers rather than an animation, so the notice stays readable when motion is reduced.
  useEffect(() => {
    if (notice === null) {
      return undefined
    }
    const timer = setTimeout(
      () => {
        setNotice(notice === 'shown' ? 'fading' : null)
      },
      notice === 'shown' ? NOTICE_VISIBLE_MS : NOTICE_FADE_MS,
    )
    return (): void => {
      clearTimeout(timer)
    }
  }, [notice])
  return [notice, setNotice]
}

// ─── Bitcoin price source ────────────────────────────────────────────────────

type PriceSourceOptions = RouterOutput['settings']['priceSource']
type PriceStatus = RouterOutput['settings']['priceStatus']
interface PriceChange {
  source?: PriceSourceOptions['selected']
  fallbacks?: boolean
}
const PRICE_SOURCE_QUERY_KEY = ['price-source']
const PRICE_STATUS_QUERY_KEY = ['price-status']
// Queries showing USD values from the current price, refreshed after a change.
const USD_QUERY_KEYS = [getQueryKey(trpc.portalProve.controlCenter.getData)]
// Reset rather than refreshed: a failed price request would otherwise keep showing a price from a source
// the change no longer allows, and account balances never refetch on mount.
const RESET_USD_QUERY_KEYS = [
  getQueryKey(trpc.portalProve.retrieveBitcoinPrice),
  getQueryKey(trpc.portalProve.onchain.bitcoinAccountBalances),
]

interface StatusResult {
  status: 'loading' | 'error' | 'success'
  data: PriceStatus | undefined
}

/**
 * The price status, only when its last refresh succeeded and it describes the current choice.
 * React Query keeps the previous data after a failed refresh; that must never read as current.
 */
function currentStatus(
  result: StatusResult | undefined,
  options: Pick<PriceSourceOptions, 'selected' | 'fallbacks'> | null,
): PriceStatus | null {
  const status = result?.status === 'success' ? result.data : undefined
  if (!status || !options || status.selected !== options.selected || status.fallbacks !== options.fallbacks) {
    return null
  }
  return status
}

function withChange(options: PriceSourceOptions, change: PriceChange): PriceSourceOptions {
  return { ...options, selected: change.source ?? options.selected, fallbacks: change.fallbacks ?? options.fallbacks }
}

function PriceSourceSettings(): JSX.Element {
  const queryClient = useQueryClient()
  // Changes Sentinel has not confirmed yet, shown over the saved settings until their save finishes.
  const [unsaved, setUnsaved] = useState<PriceChange | null>(null)
  // From a change until the price has been checked under the saved settings.
  const [checking, setChecking] = useState(false)
  // Changes made while a save request runs, sent when it finishes; the latest value of each setting wins.
  const pending = useRef<PriceChange | null>(null)
  const sending = useRef(false)
  // Counts changes, so a check that a later change has superseded never reports.
  const changeCount = useRef(0)
  const query = useQuery({
    queryKey: PRICE_SOURCE_QUERY_KEY,
    queryFn: async ({ signal }) => baseTrpc.settings.priceSource.query(undefined, { signal }),
    // A refresh started before a save finished could bring back the old settings.
    enabled: unsaved === null,
  })
  // Separate from the options, which must stay usable while a price lookup waits on the network.
  const statusQuery = useQuery({
    queryKey: PRICE_STATUS_QUERY_KEY,
    queryFn: async ({ signal }) => baseTrpc.settings.priceStatus.query(undefined, { signal }),
  })
  const saved: PriceSourceOptions | null = query.data ?? null
  const options = saved && unsaved ? withChange(saved, unsaved) : saved
  const [savedNotice, setSavedNotice] = useFadingNotice()

  // Every change is kept, including each step of choosing with the keyboard. The controls stay enabled,
  // since disabling them would drop keyboard focus.
  const change = (next: PriceChange): void => {
    if (!saved) {
      return
    }
    changeCount.current += 1
    pending.current = { ...pending.current, ...next }
    setUnsaved((current) => ({ ...current, ...next }))
    setSavedNotice(null)
    setChecking(true)
    void save()
  }

  /** Sends the pending changes in order, then checks the price under the saved settings. */
  const save = async (): Promise<void> => {
    if (sending.current) {
      return
    }
    sending.current = true
    const takePending = (): PriceChange | null => {
      const next = pending.current
      pending.current = null
      return next
    }
    let result: PriceSourceOptions | null = null
    let failed: PriceChange | null = null
    try {
      await queryClient.cancelQueries({ queryKey: PRICE_SOURCE_QUERY_KEY })
      for (let next = takePending(); next !== null; next = takePending()) {
        try {
          result = await baseTrpc.settings.setPriceSettings.mutate(next)
        } catch {
          // Changes made meanwhile are dropped with it, and the saved settings are shown again.
          failed = { ...next, ...takePending() }
        }
      }
    } finally {
      sending.current = false
    }

    const latest = changeCount.current
    if (result) {
      queryClient.setQueryData(PRICE_SOURCE_QUERY_KEY, result)
    }
    setUnsaved(null)
    if (failed) {
      toast.error(
        failed.source === undefined
          ? 'Could not save the fallback setting. Please try again.'
          : 'Could not save the price source. Please try again.',
      )
    }
    // A status request that began before the save would describe the old choice, so start a new one.
    await queryClient.cancelQueries({ queryKey: PRICE_STATUS_QUERY_KEY })
    if (latest !== changeCount.current) {
      return
    }
    // Refreshed after a failure too, since a lost reply can follow a committed write.
    const refreshing = Promise.all([
      queryClient.invalidateQueries({ queryKey: PRICE_SOURCE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PRICE_STATUS_QUERY_KEY }),
      ...USD_QUERY_KEYS.map(async (queryKey) => queryClient.invalidateQueries({ queryKey })),
      ...RESET_USD_QUERY_KEYS.map(async (queryKey) => queryClient.resetQueries({ queryKey })),
    ])
    // After a failure, the refresh runs in the background so another attempt is not held up.
    if (!failed) {
      await refreshing
    }
    if (latest !== changeCount.current) {
      return
    }
    setChecking(false)
    // Confirm only when a successful check shows the saved choice supplying the price.
    const status = failed ? null : currentStatus(queryClient.getQueryState<PriceStatus>(PRICE_STATUS_QUERY_KEY), result)
    if (status?.price && status.price.source === status.selected && !status.price.lastKnown) {
      setSavedNotice('shown')
    }
  }

  const label = (name: string | undefined): string | undefined =>
    options?.sources.find((source) => source.name === name)?.label
  const selectedLabel = label(options?.selected) ?? 'your primary price source'
  // Read through the query result, so a status that arrives or changes later renders.
  const status = checking ? null : currentStatus(statusQuery, options)
  const fallbackLabel =
    status?.price && !status.price.lastKnown && status.price.source !== status.selected
      ? label(status.price.source)
      : undefined

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
      <Box>
        <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
          Bitcoin price
        </Text>
        <Text id="price-source-description" mt={2} textStyle="text/sm" color="neutral.600" maxW="36ch">
          Used to show your balances in US dollars. Price requests include no wallet information.
        </Text>
      </Box>
      <FormControl isDisabled={!options} aria-busy={checking}>
        <FormLabel htmlFor="price-source" textStyle="text/sm" mb={2}>
          Price source
        </FormLabel>
        <HStack gap={2}>
          <Select
            id="price-source"
            flex={1}
            aria-describedby="price-source-description"
            value={options?.selected ?? ''}
            onChange={(event) => {
              const next = options?.sources.find((source) => source.name === event.target.value)
              if (next) {
                change({ source: next.name })
              }
            }}
          >
            {options?.sources.map((source) => (
              <option key={source.name} value={source.name}>
                {source.label}
              </option>
            ))}
          </Select>
          <HStack
            as="output"
            w={4}
            flexShrink={0}
            color="green.600"
            opacity={checking || savedNotice === 'shown' ? 1 : 0}
            transition={`opacity ${NOTICE_FADE_MS}ms ease-out`}
          >
            {checking ? (
              <>
                <Spinner size="xs" color="neutral.500" />
                <VisuallyHidden>Checking the price source</VisuallyHidden>
              </>
            ) : (
              savedNotice !== null && (
                <>
                  <CircleCheckIcon size={16} aria-hidden />
                  <VisuallyHidden>Price settings saved</VisuallyHidden>
                </>
              )
            )}
          </HStack>
        </HStack>
        <Checkbox
          id="price-fallbacks"
          mt={4}
          size="sm"
          colorScheme="orange"
          aria-describedby="price-fallbacks-description"
          isChecked={options?.fallbacks ?? true}
          onChange={(event) => {
            change({ fallbacks: event.target.checked })
          }}
        >
          <Text textStyle="text/sm">Allow fallbacks</Text>
        </Checkbox>
        <Text id="price-fallbacks-description" mt={1} textStyle="text/xs" color="neutral.600">
          If your primary price source is unavailable, use the next best source.
        </Text>
        {query.isError && (
          <Text role="alert" mt={2} textStyle="text/sm" color="error.700">
            Could not load price settings. Refresh to try again.
          </Text>
        )}
        {!checking && statusQuery.isError && (
          <Text role="alert" mt={2} textStyle="text/sm" color="error.700">
            Could not check the price source. Refresh to try again.
          </Text>
        )}
        {fallbackLabel !== undefined && (
          <Text as="output" display="block" mt={2} textStyle="text/xs" color="neutral.600">
            Using {fallbackLabel} while {selectedLabel} is unavailable.
          </Text>
        )}
        {status?.price?.lastKnown === true && (
          <Text as="output" display="block" mt={2} textStyle="text/xs" color="neutral.600">
            No price source is available right now. Showing the last known price.
          </Text>
        )}
        {status && status.price === null && (
          <Text as="output" display="block" mt={2} textStyle="text/xs" color="error.700">
            No price is available right now.
          </Text>
        )}
      </FormControl>
    </SimpleGrid>
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
  const connections = useSavedConnections()
  const saved = connections.data
  const profiles = saved?.profiles ?? []
  const activeId = saved?.activeId ?? null
  const active = profiles.find((profile) => profile.id === activeId)
  // Until another connection is chosen, the form edits the active one.
  const [chosen, setChosen] = useState<ConnectionSelection | null>(null)
  const selection: ConnectionSelection | null = chosen ?? (activeId === null ? null : { kind: 'saved', id: activeId })
  const isNew = selection?.kind === 'new'
  const selectedId = selection?.kind === 'saved' ? selection.id : null
  const selected = profiles.find((profile) => profile.id === selectedId)
  const isActive = selected?.id === activeId
  const isLoading = saved === undefined

  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [protocol, setProtocol] = useState<'tcp' | 'ssl'>('ssl')
  const [torEnabled, setTorEnabled] = useState(false)
  const [nickname, setNickname] = useState('')
  const [renaming, setRenaming] = useState(false)
  // The saved version the form was loaded from, so edits made in another window are not overwritten.
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null)
  const [pendingSelection, setPendingSelection] = useState<ConnectionSelection | null>(null)
  const [deleting, setDeleting] = useState<SavedConnection | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'rename' | 'delete' | null>(null)
  const isSaving = busy === 'save'
  const isTesting = busy === 'test'
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [torFailure, setTorFailure] = useState<string | null>(null)
  const [torStartedAt, setTorStartedAt] = useState<number | null>(null)
  // Failures from attempts before this one are stale. Infinity ignores all failures
  // while a start request is in flight; null means none has been requested.
  const [torAttemptAwaited, setTorAttemptAwaited] = useState<number | null>(null)
  const previousTorState = useRef<string | undefined>(undefined)
  const [torReadyNotice, setTorReadyNotice] = useFadingNotice()
  const [directConfirmation, setDirectConfirmation] = useState<'test' | 'save' | null>(null)
  const savedTor = selected?.torEnabled === true
  const torState = electrumStatus?.tor?.state
  const torAttempt = electrumStatus?.tor?.attempt ?? 0
  const torStarting = torEnabled && torState === 'starting'
  // Connecting without Tor after this connection or the active one used it, or right
  // after Tor failed, would reveal this computer's IP address. Ask before doing that.
  const leavingTor = !torEnabled && (savedTor || active?.torEnabled === true || torFailure !== null)
  const torFailedForActiveConnection =
    torFailure !== null || (active?.torEnabled === true && torState === 'failed' && !torEnabled)
  const torStartingFade = useTorStartingFade()
  const conflict = isDirty && selected !== undefined && loadedRevision !== null && selected.revision !== loadedRevision
  const deletedElsewhere = selectedId !== null && saved !== undefined && selected === undefined
  const formDisabled = isLoading || busy !== null || pendingSelection !== null || deleting !== null

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
    if (torState === 'ready' && savedTor && !isDirty && !torEnabled) {
      setTorEnabled(true)
      setTorFailure(null)
    }
  }, [torState, savedTor, isDirty, torEnabled])

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
  }, [torState, torEnabled, setTorReadyNotice])

  // Show the chosen connection's saved values until the form is edited.
  const selectedHost = selected?.host
  const selectedPort = selected?.port
  const selectedProtocol = selected?.protocol
  const selectedTor = selected?.torEnabled
  const selectedRevision = selected?.revision
  useEffect(() => {
    if (isDirty) {
      return
    }
    if (isNew) {
      setHost('')
      setPort('50002')
      setProtocol('ssl')
      setTorEnabled(false)
      setLoadedRevision(null)
    } else if (
      selectedHost !== undefined &&
      selectedPort !== undefined &&
      selectedProtocol !== undefined &&
      selectedTor !== undefined &&
      selectedRevision !== undefined
    ) {
      setHost(selectedHost)
      setPort(String(selectedPort))
      setProtocol(selectedProtocol)
      setTorEnabled(selectedTor)
      setLoadedRevision(selectedRevision)
    }
  }, [isDirty, isNew, selectedHost, selectedPort, selectedProtocol, selectedTor, selectedRevision])

  const edit = (): void => {
    setIsDirty(true)
    setTestResult(null)
  }

  const applySelection = (next: ConnectionSelection | null): void => {
    setChosen(next)
    setIsDirty(false)
    setRenaming(false)
    setNickname('')
    setTestResult(null)
    setTorFailure(null)
    setPendingSelection(null)
  }

  // Changing connections would discard unsaved edits, so ask first.
  const choose = (next: ConnectionSelection | null): void => {
    if (isDirty) {
      setPendingSelection(next ?? { kind: 'saved', id: activeId ?? '' })
    } else {
      applySelection(next)
    }
  }

  const refreshConnections = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: SAVED_CONNECTIONS_QUERY_KEY })
  }

  const handleTorChange = (enabled: boolean): void => {
    setTorEnabled(enabled)
    edit()
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

  const connectionDetails = (): RouterInput['settings']['testElectrum'] => ({
    host: host.trim(),
    port: Number(port.trim()),
    protocol,
    torEnabled,
  })

  const handleTest = async (): Promise<void> => {
    setBusy('test')
    setTestResult(null)
    try {
      const baseUrl = import.meta.env.VITE_BACKEND_API_URL ?? ''
      const res = await fetch(`${baseUrl}/settings.testElectrum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transformer.serialize(connectionDetails())),
      })

      if (!res.ok) {
        const data = parseUnknown(ErrorResponseSchema, await res.json().catch(() => null)).unwrapOr(null)
        const msg = data?.error.json?.message ?? data?.error.message ?? 'Connection failed'
        setTestResult({ ok: false, message: msg })
        return
      }

      setTestResult({ ok: true, message: 'Connection successful' })
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' })
    } finally {
      setBusy(null)
    }
  }

  const handleSave = async (): Promise<void> => {
    setBusy('save')
    try {
      if (isNew) {
        // Saving a new connection never connects to it.
        const created = await createConnection({ ...connectionDetails(), nickname: nickname.trim() })
        if (created.isErr()) {
          toast.error(`Could not save the connection: ${created.unwrapErr().message}`)
          return
        }
        await refreshConnections()
        applySelection({ kind: 'saved', id: created.unwrap().id })
        toast.success('Connection saved. Choose Connect when you want to use it.')
        return
      }
      if (!selected) {
        return
      }
      const connected = await connectConnection({
        id: selected.id,
        revision: loadedRevision ?? selected.revision,
        connection: connectionDetails(),
      })
      if (connected.isErr()) {
        toast.error(`Failed to connect: ${connected.unwrapErr().message}`)
        return
      }
      await refreshConnections()
      setIsDirty(false)
      setTestResult(null)
      // The saved connection now reflects the user's routing choice.
      setTorFailure(null)
      refreshStatus()
      toast.success(`Connected to ${connected.unwrap().nickname}`)
    } finally {
      setBusy(null)
    }
  }

  const handleRename = async (): Promise<void> => {
    if (!selected) {
      return
    }
    setBusy('rename')
    try {
      const renamed = await renameConnection({
        id: selected.id,
        revision: selected.revision,
        nickname: nickname.trim(),
      })
      if (renamed.isErr()) {
        toast.error(`Could not rename the connection: ${renamed.unwrapErr().message}`)
        return
      }
      // This form's own rename is not an edit made in another window.
      if (loadedRevision === selected.revision) {
        setLoadedRevision(renamed.unwrap().revision)
      }
      await refreshConnections()
      setRenaming(false)
      setNickname('')
      toast.success('Connection renamed')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleting) {
      return
    }
    setBusy('delete')
    setDeleteError(null)
    try {
      const deleted = await deleteConnection({ id: deleting.id, revision: deleting.revision })
      if (deleted.isErr()) {
        setDeleteError(deleted.unwrapErr().message)
        // Pick up changes made in another window without discarding this form.
        void refreshConnections()
        return
      }
      await refreshConnections()
      if (deleting.id === selectedId) {
        applySelection(null)
      }
      setDeleting(null)
      toast.success('Connection deleted')
    } finally {
      setBusy(null)
    }
  }

  const portNumber = Number(port.trim())
  const validServer = host.trim() !== '' && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65_535
  const atLimit = saved !== undefined && profiles.length >= saved.limit
  const canSave = isNew
    ? validServer && nickname.trim() !== '' && !atLimit
    : selected !== undefined &&
      validServer &&
      !conflict &&
      (isDirty || !isActive || electrumStatus?.connected === false)
  const saveLabel = isNew
    ? 'Save connection'
    : isDirty
      ? isActive
        ? 'Save & Reconnect'
        : 'Save & Connect'
      : isActive
        ? 'Reconnect'
        : 'Connect'

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
            <Text
              textStyle="text/sm"
              fontWeight="medium"
              color={electrumStatus.connected ? 'green.700' : 'red.700'}
              overflowWrap="anywhere"
            >
              {electrumStatus.connected ? 'Connected' : 'Disconnected'}
              {active ? ` · ${active.nickname}` : ''}
            </Text>
            <Text textStyle="text/xs" color={electrumStatus.connected ? 'green.600' : 'red.600'} wordBreak="break-all">
              {electrumStatus.host}:{electrumStatus.port} ({electrumStatus.protocol.toUpperCase()})
            </Text>
            {!electrumStatus.connected && (
              <Text textStyle="text/sm" color="red.700">
                {torFailedForActiveConnection
                  ? 'Your saved data is still on this device. Turn Tor on to try again, or choose another saved connection.'
                  : 'Your saved data is still on this device. Check your connection, or choose another saved connection.'}
              </Text>
            )}
          </VStack>
        </HStack>
      )}

      {saved === undefined ? (
        connections.isError ? (
          <HStack gap={3} w="full" px={3} py={2} borderRadius="md" bg="red.50">
            <Text role="alert" textStyle="text/sm" color="red.700" flex={1}>
              Could not load saved connections.
            </Text>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void connections.refetch()
              }}
            >
              Retry
            </Button>
          </HStack>
        ) : (
          <Spinner size="sm" aria-label="Loading saved connections" />
        )
      ) : (
        <>
          <ConnectionPicker
            connections={saved}
            selection={selection}
            isDisabled={formDisabled || renaming}
            onSelect={(id) => {
              choose({ kind: 'saved', id })
            }}
            onNew={() => {
              choose({ kind: 'new' })
            }}
            onRename={(connection) => {
              setNickname(connection.nickname)
              setRenaming(true)
            }}
            onDelete={(connection) => {
              setDeleteError(null)
              setDeleting(connection)
            }}
          />

          {pendingSelection && (
            <Notice
              message="You have unsaved changes. Discard them?"
              actions={[
                {
                  label: 'Keep editing',
                  onClick: () => {
                    setPendingSelection(null)
                  },
                },
                {
                  label: 'Discard changes',
                  onClick: () => {
                    applySelection(pendingSelection)
                  },
                },
              ]}
            />
          )}
          {conflict && (
            <Notice
              message="This connection changed in another window. Reload it before saving."
              actions={[
                {
                  label: 'Reload connection',
                  onClick: () => {
                    applySelection({ kind: 'saved', id: selected.id })
                  },
                },
              ]}
            />
          )}
          {deletedElsewhere && (
            <Notice message="This connection was deleted in another window. Choose another saved connection." />
          )}

          {(isNew || renaming) && (
            <Stack gap={1} w="full">
              <FormLabel htmlFor="connection-nickname" textStyle="text/sm" mb={0}>
                Nickname
              </FormLabel>
              <Input
                size="sm"
                id="connection-nickname"
                maxLength={80}
                placeholder="e.g. Home node"
                value={nickname}
                isDisabled={busy !== null}
                onChange={(e) => {
                  setNickname(e.target.value)
                  if (isNew) {
                    edit()
                  }
                }}
              />
              <HStack gap={3} mt={1}>
                {renaming && (
                  <Button
                    size="sm"
                    colorScheme="green"
                    isLoading={busy === 'rename'}
                    isDisabled={nickname.trim() === '' || busy !== null}
                    onClick={() => {
                      void handleRename()
                    }}
                  >
                    Save nickname
                  </Button>
                )}
                <Button
                  variant="link"
                  size="sm"
                  isDisabled={busy !== null}
                  onClick={() => {
                    if (renaming) {
                      setRenaming(false)
                      setNickname('')
                    } else {
                      choose(null)
                    }
                  }}
                >
                  Cancel
                </Button>
              </HStack>
            </Stack>
          )}

          {/* New connections can start from a public server */}
          {isNew && (
            <Stack gap={1} w="full">
              <FormLabel htmlFor="electrum-preset" textStyle="text/sm" mb={0}>
                Start with
              </FormLabel>
              <Select
                size="sm"
                id="electrum-preset"
                value={SERVER_PRESETS.find((p) => p.host === host && p.port === port) ? host : 'custom'}
                onChange={(e) => {
                  const preset = SERVER_PRESETS.find((p) => p.host === e.target.value)
                  setHost(preset?.host ?? '')
                  setPort(preset?.port ?? '50002')
                  setProtocol(preset?.protocol ?? 'ssl')
                  setTorEnabled(preset?.tor ?? false)
                  edit()
                }}
                isDisabled={formDisabled}
              >
                <option value="custom">My own server</option>
                {SERVER_PRESETS.map((p) => (
                  <option key={p.host} value={p.host}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Stack>
          )}

          {/* Host */}
          <Stack gap={1} w="full">
            <FormLabel htmlFor="electrum-host" textStyle="text/sm" mb={0}>
              Host
            </FormLabel>
            <Input
              size="sm"
              id="electrum-host"
              placeholder="Your server address"
              value={host}
              onChange={(e) => {
                setHost(e.target.value)
                edit()
              }}
              isDisabled={formDisabled}
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
                  edit()
                }}
                isDisabled={formDisabled}
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
                  edit()
                }}
                isDisabled={formDisabled}
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
                Routes Electrum requests through Tor. Exchange and price requests use your normal connection. Required
                for .onion addresses.
              </Text>
            </VStack>
            <Switch
              id="electrum-tor"
              colorScheme="green"
              isChecked={torEnabled}
              onChange={(e) => {
                handleTorChange(e.target.checked)
              }}
              isDisabled={formDisabled}
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
              isDisabled={!host.trim() || !port.trim() || formDisabled || torStarting}
            >
              Test Connection
            </Button>
            <Button
              colorScheme="green"
              onClick={() => {
                // Saving a new connection does not connect, so it cannot reveal anything.
                if (leavingTor && !isNew) {
                  setDirectConfirmation('save')
                } else {
                  void handleSave()
                }
              }}
              isLoading={isSaving}
              isDisabled={!canSave || formDisabled || renaming || torStarting}
            >
              {saveLabel}
            </Button>
          </ButtonGroup>
        </>
      )}

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

      <DeleteConnectionDialog
        connection={deleting}
        discardsChanges={deleting !== null && deleting.id === selectedId && isDirty}
        error={deleteError}
        isDeleting={busy === 'delete'}
        onCancel={() => {
          setDeleting(null)
        }}
        onConfirm={() => {
          void handleDelete()
        }}
      />
    </VStack>
  )
}

/** A warning above the form, with optional actions. */
function Notice({
  message,
  actions = [],
}: {
  message: string
  actions?: Array<{ label: string; onClick: () => void }>
}): JSX.Element {
  return (
    <Stack as="output" gap={2} w="full" px={3} py={2} borderRadius="md" bg="orange.50">
      <Text textStyle="text/sm" color="orange.800">
        {message}
      </Text>
      {actions.length > 0 && (
        <HStack gap={2} flexWrap="wrap">
          {actions.map((action) => (
            <Button key={action.label} size="sm" variant="outline" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </HStack>
      )}
    </Stack>
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
  readyNotice: FadingNotice
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
        transition={`opacity ${NOTICE_FADE_MS}ms ease-out`}
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
