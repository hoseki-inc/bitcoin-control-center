import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Box,
  Button,
  Circle,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spinner,
  Stack,
  Switch,
  type SystemStyleObject,
  Text,
  Tooltip,
  VStack,
  keyframes,
  useToken,
} from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlertIcon, CircleCheckIcon, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { type RouterOutput, baseTrpc } from '../../trpc'
import { type FadingNotice, NOTICE_FADE_MS, useFadingNotice } from './fading-notice'

type Snapshot = RouterOutput['settings']['connectionProfiles']['list']
type Profile = Snapshot['profiles'][number]
type Draft = Omit<Profile, 'id' | 'revision'> & { id?: string; revision?: number }
type Selection = { kind: 'new' } | { kind: 'saved'; profile: Profile; reload?: boolean }
// Saving a new connection never connects; connecting may save edits first.
type Operation = 'test' | 'save' | 'connect'
const queryKey = ['connection-profiles']
const api = baseTrpc.settings.connectionProfiles

function emptyDraft(): Draft {
  return { nickname: '', host: '', port: 50002, protocol: 'ssl', torEnabled: false }
}

function newConnectionChanged(draft: Draft): boolean {
  const blank = emptyDraft()
  return (
    draft.nickname !== blank.nickname ||
    draft.host !== blank.host ||
    draft.port !== blank.port ||
    draft.protocol !== blank.protocol ||
    draft.torEnabled !== blank.torEnabled
  )
}

function connectionChanged(draft: Draft, saved: Profile | undefined): boolean {
  return (
    !saved ||
    draft.host.trim() !== saved.host ||
    draft.port !== saved.port ||
    draft.protocol !== saved.protocol ||
    draft.torEnabled !== saved.torEnabled
  )
}

// ─── Connection and Tor status ───────────────────────────────────────────────

const ElectrumStatusSchema = z.object({
  connected: z.boolean(),
  connecting: z.boolean().optional(),
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

interface ElectrumStatusState {
  status: ElectrumStatus | null
  refresh: () => void
}

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
        // An error or unreadable answer means the status is unknown, not the last one seen.
        setStatus(parsed?.host != null && parsed.host !== '' ? parsed : null)
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

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Saved connections on one side and the selected connection's details on the
 * other. Only the list shows which connection is live, so the details never read
 * as the current connection.
 */
export function ElectrumSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => api.list.query(undefined, { signal }),
    refetchInterval: 10_000,
  })
  const { status, refresh: refreshStatus } = useElectrumStatus()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<Operation | 'rename' | 'delete' | null>(null)
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const promptWasOpen = useRef(false)
  const hostRef = useRef<HTMLInputElement>(null)
  const nicknameRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [nickname, setNickname] = useState('')
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [directConfirmation, setDirectConfirmation] = useState<'test' | 'connect' | null>(null)
  // Like Sparrow, a failed Tor start turns the switch off. That only changes the
  // form, not the draft: the saved connection keeps Tor and is never used directly.
  const [torForcedOff, setTorForcedOff] = useState(false)
  const [torFailure, setTorFailure] = useState<string | null>(null)
  // Set when Tor is switched off in this form, so connecting asks first, even for a new connection.
  const [torTurnedOff, setTorTurnedOff] = useState(false)
  const [onionNotice, setOnionNotice] = useState(false)
  const [torStartedAt, setTorStartedAt] = useState<number | null>(null)
  // Failures from attempts before this one are stale. Infinity ignores all failures
  // while a start request is in flight; null means none has been requested.
  const [torAttemptAwaited, setTorAttemptAwaited] = useState<number | null>(null)
  const previousTorState = useRef<string | undefined>(undefined)
  const [torReadyNotice, setTorReadyNotice] = useFadingNotice()
  const torStartingFade = useTorStartingFade()
  const [selectedEdge, torPendingGreen] = useToken('colors', ['neutral.900', 'green.200'])
  const saved = query.data?.profiles.find((item) => item.id === draft?.id)
  const active = query.data?.profiles.find((item) => item.id === query.data.activeId)
  const isNew = draft !== null && draft.id === undefined
  const dirty = draft !== null && (isNew ? newConnectionChanged(draft) : connectionChanged(draft, saved))
  const actionsDisabled = busy !== null || deleting !== null || pendingSelection !== null
  // A test saves nothing, so editing stays open while it runs; its result is dropped if anything changes.
  const controlsDisabled =
    (busy !== null && busy !== 'test') || deleting !== null || pendingSelection !== null || renaming
  // Changes whenever the form changes, so a test finishing afterwards can't report on details no longer shown.
  const formVersion = useRef(0)
  const torEnabled = draft?.torEnabled === true && !torForcedOff
  const torState = status?.tor?.state
  const torAttempt = status?.tor?.attempt ?? 0
  const torStarting = torEnabled && torState === 'starting'
  // A saved Tor connection shows the switch on before the app starts Tor; only a running Tor is solid green.
  const torWaiting = torEnabled && torState === 'stopped'
  // Onion addresses are only reachable through Tor, so they never connect directly.
  const onion = draft?.host.trim().toLowerCase().endsWith('.onion') === true
  // Ask only when this connection would go direct without a saved choice: Tor was turned
  // off here or on a connection saved with it, or Tor failed and turned the switch off.
  // Switching to a saved direct connection is already a deliberate choice.
  const leavingTor = !torEnabled && !onion && (saved?.torEnabled === true || torTurnedOff || torFailure !== null)

  useEffect(() => {
    if (!query.data || controlsDisabled) {
      return
    }
    if (!draft) {
      setDraft(
        query.data.profiles.find((item) => item.id === query.data.activeId) ?? query.data.profiles[0] ?? emptyDraft(),
      )
    } else if (!dirty && saved && saved.revision !== draft.revision) {
      formVersion.current += 1
      setDraft(saved)
    }
  }, [query.data, draft, saved, dirty, controlsDisabled])

  // The row that opened the discard prompt is disabled, so move focus to the prompt,
  // then back to the form once it's answered.
  const promptOpen = pendingSelection !== null
  useEffect(() => {
    if (promptOpen) {
      keepEditingRef.current?.focus()
    } else if (promptWasOpen.current) {
      hostRef.current?.focus()
    }
    promptWasOpen.current = promptOpen
  }, [promptOpen])

  useEffect(() => {
    if (renaming) {
      nicknameRef.current?.select()
    }
  }, [renaming])

  // Compare attempts rather than waiting to observe "starting", which a fast failure skips.
  useEffect(() => {
    if (torState === 'failed' && torEnabled && torAttempt >= (torAttemptAwaited ?? 0)) {
      setTorForcedOff(true)
      setTorFailure(status?.tor?.message ?? 'Tor couldn’t start. Turn Tor on to try again.')
      // A test result describes the route shown when it started; the switch just changed.
      formVersion.current += 1
      setTestResult(null)
    }
  }, [torState, torEnabled, torAttempt, torAttemptAwaited, status?.tor?.message])

  // A saved Tor connection restarts Tor on its own when data is requested. Once Tor
  // is ready again, show the switch on unless the form has been edited.
  useEffect(() => {
    if (torState === 'ready' && torForcedOff && !dirty) {
      setTorForcedOff(false)
      setTorFailure(null)
      formVersion.current += 1
      setTestResult(null)
    }
  }, [torState, torForcedOff, dirty])

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

  // Shows another connection with none of the previous one's form state.
  const showConnection = (next: Draft | null): void => {
    formVersion.current += 1
    setRenaming(false)
    setDraft(next)
    setTestResult(null)
    setTorForcedOff(false)
    setTorFailure(null)
    setTorTurnedOff(false)
    setPendingSelection(null)
  }
  const applySelection = (selection: Selection): void => {
    showConnection(selection.kind === 'new' ? emptyDraft() : selection.profile)
  }
  const select = (selection: Selection): void => {
    if (controlsDisabled) {
      return
    }
    if (selection.kind === 'new' ? isNew : selection.profile.id === draft?.id && selection.reload !== true) {
      return
    }
    if (dirty) {
      setPendingSelection(selection)
    } else {
      applySelection(selection)
    }
  }
  const update = (value: Partial<Draft>): void => {
    formVersion.current += 1
    setDraft((current) => (current ? { ...current, ...value } : current))
    setTestResult(null)
  }
  const startTor = (): void => {
    setTorAttemptAwaited(Number.POSITIVE_INFINITY)
    void requestTorStart().then((attempt) => {
      // If the request failed, the existing status is the one to show.
      setTorAttemptAwaited(attempt ?? 0)
      refreshStatus()
    })
  }
  const handleTorChange = (enabled: boolean): void => {
    if (!enabled && onion) {
      setOnionNotice(true)
      return
    }
    update({ torEnabled: enabled })
    setTorForcedOff(false)
    setTorFailure(null)
    setTorTurnedOff(!enabled)
    if (enabled) {
      startTor()
    }
  }
  const remember = async (profile: Profile, connected = false): Promise<void> => {
    await queryClient.cancelQueries({ queryKey })
    queryClient.setQueryData<Snapshot>(queryKey, (current) => {
      if (!current) {
        return current
      }
      const profiles = current.profiles.some((item) => item.id === profile.id)
        ? current.profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...current.profiles, profile]
      return { ...current, profiles, activeId: connected ? profile.id : current.activeId }
    })
    void queryClient.invalidateQueries({ queryKey })
  }
  const deleteProfile = async (): Promise<void> => {
    if (!deleting || busy) {
      return
    }
    setBusy('delete')
    setDeleteError(null)
    try {
      await api.delete.mutate({ id: deleting.id, revision: deleting.revision })
      await queryClient.cancelQueries({ queryKey })
      const remaining = queryClient.setQueryData<Snapshot>(queryKey, (current) =>
        current ? { ...current, profiles: current.profiles.filter((item) => item.id !== deleting.id) } : current,
      )
      // Removing another row must leave the current form (including new drafts) intact.
      if (draft?.id === deleting.id) {
        showConnection(
          remaining?.profiles.find((item) => item.id === remaining.activeId) ?? remaining?.profiles[0] ?? null,
        )
      }
      setPendingSelection(null)
      setDeleting(null)
      toast.success('Connection deleted')
      void queryClient.invalidateQueries({ queryKey })
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete the connection')
      // Refresh active/revision changes from another window without discarding this draft.
      void queryClient.invalidateQueries({ queryKey })
    } finally {
      setBusy(null)
    }
  }
  const rename = async (): Promise<void> => {
    if (draft?.id === undefined || draft.revision === undefined || actionsDisabled) {
      return
    }
    setBusy('rename')
    try {
      const renamed = await api.rename.mutate({ id: draft.id, revision: draft.revision, nickname: nickname.trim() })
      setDraft({ ...draft, nickname: renamed.nickname, revision: renamed.revision })
      setRenaming(false)
      await remember(renamed)
      toast.success('Connection renamed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename the connection')
    } finally {
      setBusy(null)
    }
  }
  const run = async (operation: Operation): Promise<void> => {
    if (!draft || actionsDisabled) {
      return
    }
    setBusy(operation)
    setTestResult(null)
    const version = formVersion.current
    // Sentinel starts Tor for this request anyway; starting it here lets the switch follow it.
    if (torEnabled && torState === 'stopped' && operation !== 'save') {
      startTor()
    }
    try {
      const details = {
        host: draft.host.trim(),
        port: draft.port,
        protocol: draft.protocol,
        // Testing and connecting use the switch, which a Tor failure turns off.
        torEnabled,
      }
      if (operation === 'test') {
        await baseTrpc.settings.testElectrum.mutate(details)
        if (version === formVersion.current) {
          setTestResult({ ok: true, message: 'Connection successful' })
        }
        return
      }
      let target = saved
      if (draft.id === undefined) {
        // A new connection is saved with the Tor setting you chose, even while a Tor failure
        // shows the switch off; only a successful direct connection below saves it as direct.
        target = await api.create.mutate({ ...details, torEnabled: draft.torEnabled, nickname: draft.nickname.trim() })
        setDraft(target)
        await remember(target)
        if (operation === 'save') {
          toast.success('Connection saved. Select Connect when you want to use it.')
          return
        }
      }
      if (target) {
        const connected = await api.connect.mutate({
          id: target.id,
          revision: draft.id === undefined ? target.revision : (draft.revision ?? target.revision),
          connection: details,
        })
        setDraft(connected)
        setTorForcedOff(false)
        // The saved connection now reflects the user's routing choice.
        setTorFailure(null)
        setTorTurnedOff(false)
        await remember(connected, true)
        refreshStatus()
        toast.success(draft.id === undefined ? 'Connection saved' : 'Connection updated')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update the connection'
      if (version === formVersion.current) {
        setTestResult({ ok: false, message })
      }
      if (operation !== 'test') {
        toast.error(message)
      }
    } finally {
      setBusy(null)
    }
  }
  // Connecting without Tor, including a test, asks first; saving a new connection never connects.
  const confirmRouting = (operation: Operation): void => {
    if (leavingTor && operation !== 'save') {
      setDirectConfirmation(operation)
    } else {
      void run(operation)
    }
  }

  if (!query.data || !draft) {
    return (
      <Stack w="full" maxW="480px">
        <Text textStyle="label/md" fontWeight="semibold">
          Electrum Server
        </Text>
        {query.isError ? (
          <Alert status="error">
            <AlertDescription>Could not load saved connections.</AlertDescription>
            <Button size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </Alert>
        ) : (
          <Spinner aria-label="Loading saved connections" />
        )}
      </Stack>
    )
  }
  const { profiles, activeId, limit } = query.data
  const atLimit = profiles.length >= limit
  const isActive = draft.id !== undefined && draft.id === activeId
  // No status (not loaded, or the request failed) is unknown, never "Connected".
  const liveness =
    status === null
      ? 'unknown'
      : status.connected
        ? 'connected'
        : status.connecting === true
          ? 'connecting'
          : 'disconnected'
  const livenessLabel = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
    unknown: 'Checking…',
  }[liveness]
  const livenessColor = { connected: 'green', disconnected: 'red', connecting: 'neutral', unknown: 'neutral' }[liveness]
  const canSubmit =
    (isNew || saved !== undefined) &&
    draft.host.trim() !== '' &&
    Number.isInteger(draft.port) &&
    draft.port > 0 &&
    draft.port <= 65535 &&
    (!isNew || draft.nickname.trim() !== '') &&
    (!isNew || !atLimit)
  const canReconnect = dirty || !isActive || (liveness !== 'connected' && liveness !== 'connecting')
  // #5: only the connection in use reconnects; any other one connects for the first time.
  const connectLabel = dirty ? (isActive ? 'Save & Reconnect' : 'Save & Connect') : isActive ? 'Reconnect' : 'Connect'
  const onionNeedsTor = onion && !torEnabled
  const submitDisabled = !canSubmit || controlsDisabled || actionsDisabled || torStarting || onionNeedsTor
  // Saving never connects: it needs valid details and, for an onion address, Tor chosen, not Tor working.
  const saveDisabled = !canSubmit || controlsDisabled || actionsDisabled || (onion && !draft.torEnabled)
  const rowButton = {
    variant: 'unstyled',
    h: 'auto',
    w: 'full',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    py: 3,
    px: 3,
    borderRadius: 0,
    textAlign: 'left',
    whiteSpace: 'normal',
  } as const
  // Rows stay readable while an action runs; the theme's grey disabled fill is for buttons.
  const rowDisabled = (selected: boolean): SystemStyleObject => {
    const style = { bgColor: selected ? 'neutral.50' : 'transparent', color: 'inherit', opacity: 0.6 }
    return { ...style, _hover: style }
  }
  const selectedShadow = `inset 2px 0 0 ${selectedEdge}`

  return (
    <Box w="full" sx={{ containerType: 'inline-size', containerName: 'electrum-settings' }}>
      <VStack align="start" gap={1} maxW="480px" mb={5}>
        <Text textStyle="label/md" fontWeight="semibold">
          Electrum Server
        </Text>
        <Text textStyle="text/sm" color="neutral.600">
          Configure your Bitcoin Electrum server connection. Use your own server for maximum privacy.
        </Text>
      </VStack>
      {pendingSelection && (
        <Alert status="warning" mb={4} maxW="480px" flexWrap="wrap" gap={3}>
          <AlertDescription>You have unsaved changes. Discard them to continue?</AlertDescription>
          <Button
            ref={keepEditingRef}
            size="sm"
            onClick={() => {
              setPendingSelection(null)
            }}
          >
            Keep editing
          </Button>
          <Button
            size="sm"
            onClick={() => {
              applySelection(pendingSelection)
            }}
          >
            Discard changes
          </Button>
        </Alert>
      )}
      {saved && saved.revision !== draft.revision && dirty && !busy && (
        <Alert status="warning" mb={4} maxW="480px" flexWrap="wrap" gap={3}>
          <AlertDescription>This connection changed in another window. Reload it before saving.</AlertDescription>
          <Button
            size="sm"
            isDisabled={controlsDisabled}
            onClick={() => {
              select({ kind: 'saved', profile: saved, reload: true })
            }}
          >
            Reload connection
          </Button>
        </Alert>
      )}
      {draft.id !== undefined && !saved && (
        <Alert status="warning" mb={4} maxW="480px">
          <AlertDescription>
            This connection was deleted in another window. Choose another saved connection or create a new one.
          </AlertDescription>
        </Alert>
      )}
      <Box
        className="connection-layout"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 6,
          '@container electrum-settings (min-width: 720px)': {
            gridTemplateColumns: 'minmax(200px, 280px) minmax(0, 480px)',
            gap: 0,
            '.connection-list': { borderRightWidth: '1px', pr: 0 },
            '.connection-details': { pl: 8 },
          },
        }}
      >
        <Box as="nav" className="connection-list" aria-label="Saved connections" minW={0}>
          <HStack justify="space-between" px={3} pb={2} borderBottomWidth="1px" flexWrap="wrap">
            <Text textStyle="label/sm">Saved connections</Text>
            <Text textStyle="text/xs" color="neutral.600">
              {profiles.length} of {limit}
            </Text>
          </HStack>
          {profiles.map((item) => {
            const live = item.id === activeId
            return (
              <Button
                key={item.id}
                {...rowButton}
                bg={draft.id === item.id ? 'neutral.50' : undefined}
                boxShadow={draft.id === item.id ? selectedShadow : undefined}
                _disabled={rowDisabled(draft.id === item.id)}
                borderBottomWidth="1px"
                aria-current={draft.id === item.id ? 'true' : undefined}
                isDisabled={controlsDisabled}
                onClick={() => {
                  select({ kind: 'saved', profile: item })
                }}
              >
                <Text as="span" textStyle="label/sm" overflowWrap="anywhere">
                  {item.nickname}
                </Text>
                <HStack as="span" gap={2} mt={1}>
                  {live && <Circle size="8px" bg={`${livenessColor}.500`} />}
                  <Text as="span" textStyle="text/xs" color={live ? `${livenessColor}.700` : 'neutral.600'}>
                    {live ? livenessLabel : item.torEnabled ? 'Tor' : 'Direct'}
                  </Text>
                </HStack>
              </Button>
            )
          })}
          <Button
            {...rowButton}
            bg={isNew ? 'neutral.50' : undefined}
            boxShadow={isNew ? selectedShadow : undefined}
            _disabled={rowDisabled(isNew)}
            aria-current={isNew ? 'true' : undefined}
            isDisabled={controlsDisabled || (atLimit && !isNew)}
            onClick={() => {
              select({ kind: 'new' })
            }}
          >
            <HStack as="span" gap={2}>
              <Plus size={14} aria-hidden="true" />
              <Text as="span" textStyle="label/sm">
                New connection
              </Text>
            </HStack>
            {atLimit && !isNew && (
              <Text as="span" textStyle="text/xs" color="neutral.600" mt={1}>
                Limit reached. Delete one to add another.
              </Text>
            )}
          </Button>
        </Box>

        <Stack as="section" className="connection-details" aria-label="Connection details" gap={5} minW={0}>
          <HStack justify="space-between" align="start" gap={3} pb={3} borderBottomWidth="1px">
            {isNew ? (
              <Stack gap={0}>
                <Text textStyle="label/md" fontWeight="semibold">
                  New connection
                </Text>
                <Text textStyle="text/xs" color="neutral.600">
                  {profiles.length} of {limit} saved
                </Text>
              </Stack>
            ) : renaming ? (
              <HStack gap={2} flex={1} minW={0}>
                <Input
                  ref={nicknameRef}
                  aria-label="Connection name"
                  size="sm"
                  maxLength={80}
                  value={nickname}
                  isDisabled={actionsDisabled}
                  onChange={(event) => {
                    setNickname(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && nickname.trim() !== '') {
                      void rename()
                    } else if (event.key === 'Escape') {
                      setRenaming(false)
                    }
                  }}
                />
                <IconButton
                  aria-label="Save connection name"
                  icon={<Check size={16} aria-hidden="true" />}
                  size="sm"
                  variant="ghost"
                  isLoading={busy === 'rename'}
                  isDisabled={nickname.trim() === '' || actionsDisabled}
                  onClick={() => void rename()}
                />
                <IconButton
                  aria-label="Cancel renaming"
                  icon={<X size={16} aria-hidden="true" />}
                  size="sm"
                  variant="ghost"
                  isDisabled={actionsDisabled}
                  onClick={() => {
                    setRenaming(false)
                  }}
                />
              </HStack>
            ) : (
              <Stack gap={0} minW={0}>
                <HStack gap={1}>
                  <Text textStyle="label/md" fontWeight="semibold" overflowWrap="anywhere">
                    {draft.nickname}
                  </Text>
                  {saved && (
                    <IconButton
                      aria-label={`Rename ${draft.nickname}`}
                      icon={<Pencil size={14} aria-hidden="true" />}
                      size="xs"
                      variant="ghost"
                      color="neutral.500"
                      isDisabled={actionsDisabled || renaming}
                      onClick={() => {
                        setNickname(draft.nickname)
                        setRenaming(true)
                        setTestResult(null)
                      }}
                    />
                  )}
                </HStack>
                <Text
                  as="output"
                  textStyle="text/xs"
                  color={isActive ? `${livenessColor}.700` : 'neutral.600'}
                  overflowWrap="anywhere"
                >
                  {!isActive
                    ? 'Not connected'
                    : status
                      ? `${livenessLabel} · ${status.host}:${status.port} (${status.protocol.toUpperCase()}${active?.torEnabled === true ? ' · Tor' : ''})`
                      : livenessLabel}
                </Text>
              </Stack>
            )}
            {saved && !renaming && (
              <Tooltip label="Delete connection" shouldWrapChildren>
                <IconButton
                  aria-label={`Delete ${saved.nickname}`}
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  variant="ghost"
                  size="sm"
                  color="neutral.600"
                  _hover={{ color: 'error.600', bg: 'error.50' }}
                  isDisabled={actionsDisabled || renaming}
                  onClick={() => {
                    setDeleteError(null)
                    setDeleting(saved)
                  }}
                />
              </Tooltip>
            )}
          </HStack>
          {isActive && liveness === 'disconnected' && (
            <Text textStyle="text/sm" color="red.700">
              {torFailure !== null || (active?.torEnabled === true && torState === 'failed')
                ? 'Your saved data is still on this device. Turn Tor on to try again, or choose another saved connection.'
                : 'Your saved data is still on this device. Retry this connection or choose another saved connection.'}
            </Text>
          )}
          {isNew && (
            <>
              <FormControl>
                <FormLabel htmlFor="connection-nickname" textStyle="label/sm">
                  Name
                </FormLabel>
                <Input
                  id="connection-nickname"
                  size="sm"
                  maxLength={80}
                  placeholder="e.g. Home node"
                  value={draft.nickname}
                  isDisabled={controlsDisabled}
                  onChange={(event) => {
                    update({ nickname: event.target.value })
                  }}
                />
              </FormControl>
              <FormControl>
                <FormLabel htmlFor="connection-starter" textStyle="label/sm">
                  Start with
                </FormLabel>
                <Select
                  id="connection-starter"
                  size="sm"
                  isDisabled={controlsDisabled}
                  value={draft.host === 'electrum.blockstream.info' ? draft.host : 'custom'}
                  onChange={(event) => {
                    // Presets change the server only; your Tor choice stays.
                    update({
                      host: event.target.value === 'custom' ? '' : event.target.value,
                      port: 50002,
                      protocol: 'ssl',
                    })
                  }}
                >
                  <option value="custom">My own server</option>
                  <option value="electrum.blockstream.info">Blockstream (Public)</option>
                </Select>
              </FormControl>
            </>
          )}
          <FormControl>
            <FormLabel htmlFor="connection-host" textStyle="label/sm">
              Host
            </FormLabel>
            <Input
              id="connection-host"
              ref={hostRef}
              size="sm"
              placeholder="Your server address"
              value={draft.host}
              isDisabled={controlsDisabled}
              onChange={(event) => {
                update({ host: event.target.value })
              }}
            />
          </FormControl>
          <HStack gap={3}>
            <FormControl minW={0}>
              <FormLabel htmlFor="connection-port" textStyle="label/sm">
                Port
              </FormLabel>
              <Input
                id="connection-port"
                size="sm"
                type="number"
                min={1}
                max={65535}
                value={draft.port || ''}
                isDisabled={controlsDisabled}
                onChange={(event) => {
                  update({ port: Number(event.target.value) })
                }}
              />
            </FormControl>
            <FormControl w="120px" flexShrink={0}>
              <FormLabel htmlFor="connection-protocol" textStyle="label/sm">
                Protocol
              </FormLabel>
              <Select
                id="connection-protocol"
                size="sm"
                value={draft.protocol}
                isDisabled={controlsDisabled}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'tcp' || value === 'ssl') {
                    update({ protocol: value })
                  }
                }}
              >
                <option value="ssl">SSL</option>
                <option value="tcp">TCP</option>
              </Select>
            </FormControl>
          </HStack>
          <HStack justify="space-between" gap={3}>
            <Box>
              <FormLabel htmlFor="connection-tor" textStyle="label/sm" mb={0}>
                Connect via Tor
              </FormLabel>
              <Text textStyle="text/xs" color="neutral.600">
                Routes Electrum requests through Tor. Exchange and price requests use your normal connection. Required
                for .onion addresses.
              </Text>
            </Box>
            <Switch
              id="connection-tor"
              colorScheme="green"
              isChecked={torEnabled}
              isDisabled={controlsDisabled}
              onChange={(event) => {
                handleTorChange(event.target.checked)
              }}
              sx={
                torStarting
                  ? { '.chakra-switch__track': { animation: `${torStartingFade} 3s ease-in-out infinite` } }
                  : torWaiting
                    ? { '.chakra-switch__track[data-checked]': { bg: torPendingGreen } }
                    : undefined
              }
            />
          </HStack>
          {onionNeedsTor && torFailure === null && (
            <Text as="output" textStyle="text/sm" color="neutral.600">
              Onion addresses need Tor. Turn Tor on to connect.
            </Text>
          )}
          <TorStatusLine
            enabled={torEnabled}
            state={torState}
            progress={status?.tor?.progress}
            failure={torFailure}
            readyNotice={torReadyNotice}
            slow={torStartedAt !== null && Date.now() - torStartedAt > TOR_SLOW_START_MS}
          />
          {testResult && (
            <Alert status={testResult.ok ? 'success' : 'error'}>
              <AlertDescription>{testResult.message}</AlertDescription>
            </Alert>
          )}
          <HStack gap={3} flexWrap="wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                confirmRouting('test')
              }}
              isLoading={busy === 'test'}
              isDisabled={draft.host.trim() === '' || actionsDisabled || renaming || torStarting || onionNeedsTor}
            >
              Test Connection
            </Button>
            {isNew && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  confirmRouting('save')
                }}
                isLoading={busy === 'save'}
                isDisabled={saveDisabled}
              >
                Save
              </Button>
            )}
            <Button
              size="sm"
              colorScheme="green"
              onClick={() => {
                confirmRouting('connect')
              }}
              isLoading={busy === 'connect'}
              isDisabled={submitDisabled || (!isNew && !canReconnect)}
            >
              {isNew ? 'Save & Connect' : connectLabel}
            </Button>
          </HStack>
        </Stack>
      </Box>
      <Modal
        isOpen={onionNotice}
        onClose={() => {
          setOnionNotice(false)
        }}
        isCentered
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>This connection needs Tor</ModalHeader>
          <ModalBody>
            <Text textStyle="text/sm" color="neutral.700">
              This is an onion address, so it can only be reached through Tor.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button
              flex={1}
              onClick={() => {
                setOnionNotice(false)
              }}
            >
              Keep Tor on
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
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
              The server will be able to see your IP address.
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
                const operation = directConfirmation
                setDirectConfirmation(null)
                if (operation !== null) {
                  void run(operation)
                }
              }}
            >
              Connect without Tor
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <AlertDialog
        isOpen={deleting !== null}
        leastDestructiveRef={cancelDeleteRef}
        finalFocusRef={hostRef}
        onClose={() => {
          if (busy !== 'delete') {
            setDeleting(null)
          }
        }}
        closeOnEsc={busy !== 'delete'}
        closeOnOverlayClick={busy !== 'delete'}
        isCentered
      >
        <AlertDialogOverlay />
        <AlertDialogContent mx={4}>
          <AlertDialogHeader>
            <Text textStyle="text/lg" overflowWrap="anywhere">
              Delete “{deleting?.nickname}”?
            </Text>
          </AlertDialogHeader>
          <AlertDialogBody>
            {deleting?.id === activeId ? (
              <Text textStyle="text/sm">
                You’re connected to this server. Connect to another saved connection before deleting this one.
              </Text>
            ) : (
              <Text textStyle="text/sm">
                This removes the saved connection. Your accounts and wallet data are kept.
              </Text>
            )}
            {deleting?.id === draft.id && dirty && deleting?.id !== activeId && (
              <Text textStyle="text/sm" mt={3}>
                Your unsaved changes to this connection will also be discarded.
              </Text>
            )}
            {deleteError !== null && (
              <Alert status="error" mt={3}>
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
          </AlertDialogBody>
          <AlertDialogFooter gap={3}>
            <Button
              ref={cancelDeleteRef}
              variant="outline"
              size="sm"
              isDisabled={busy === 'delete'}
              onClick={() => {
                setDeleting(null)
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="error"
              isLoading={busy === 'delete'}
              isDisabled={busy !== null || deleting?.id === activeId}
              onClick={() => void deleteProfile()}
            >
              Delete connection
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Box>
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
