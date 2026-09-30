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
  Text,
  Tooltip,
  VStack,
  keyframes,
  useToken,
} from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, CircleCheckIcon, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { type RouterOutput, baseTrpc } from '../../trpc'
import { type FadingNotice, NOTICE_FADE_MS, useFadingNotice } from './fading-notice'

type Snapshot = RouterOutput['settings']['connectionProfiles']['list']
type Profile = Snapshot['profiles'][number]
type Draft = Omit<Profile, 'id' | 'revision'> & { id?: string; revision?: number }
type Selection = { kind: 'new' } | { kind: 'saved'; profile: Profile; rename?: boolean; reload?: boolean }
const queryKey = ['connection-profiles']
const api = baseTrpc.settings.connectionProfiles

function emptyDraft(): Draft {
  return { nickname: '', host: '', port: 50002, protocol: 'ssl', torEnabled: false }
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

// ─── Settings ────────────────────────────────────────────────────────────────

/** One form and one draft remain mounted when the saved selector changes layout. */
export function ElectrumSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => api.list.query(undefined, { signal }),
    refetchInterval: 10_000,
  })
  const { status, refresh: refreshStatus } = useElectrumStatus()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | 'rename' | 'delete' | null>(null)
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const hostRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [nickname, setNickname] = useState('')
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null)
  const [previousId, setPreviousId] = useState<string>()
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [directConfirmation, setDirectConfirmation] = useState<'test' | 'save' | null>(null)
  // Like Sparrow, a failed Tor start turns the switch off. That only changes the
  // form, not the draft: the saved connection keeps Tor and is never used directly.
  const [torForcedOff, setTorForcedOff] = useState(false)
  const [torFailure, setTorFailure] = useState<string | null>(null)
  const [torStartedAt, setTorStartedAt] = useState<number | null>(null)
  // Failures from attempts before this one are stale. Infinity ignores all failures
  // while a start request is in flight; null means none has been requested.
  const [torAttemptAwaited, setTorAttemptAwaited] = useState<number | null>(null)
  const previousTorState = useRef<string | undefined>(undefined)
  const [torReadyNotice, setTorReadyNotice] = useFadingNotice()
  const torStartingFade = useTorStartingFade()
  const saved = query.data?.profiles.find((item) => item.id === draft?.id)
  const active = query.data?.profiles.find((item) => item.id === query.data.activeId)
  const isNew = draft !== null && draft.id === undefined
  const dirty = draft !== null && (isNew ? draft.host !== '' || draft.nickname !== '' : connectionChanged(draft, saved))
  const actionsDisabled = busy !== null || deleting !== null || pendingSelection !== null
  const controlsDisabled = actionsDisabled || renaming
  const torEnabled = draft?.torEnabled === true && !torForcedOff
  const torState = status?.tor?.state
  const torAttempt = status?.tor?.attempt ?? 0
  const torStarting = torEnabled && torState === 'starting'
  // Connecting without Tor after this connection or the active one used it, or right
  // after Tor failed, would reveal this computer's IP address. Ask before doing that.
  const leavingTor = !torEnabled && (saved?.torEnabled === true || active?.torEnabled === true || torFailure !== null)

  useEffect(() => {
    if (!query.data || controlsDisabled) {
      return
    }
    if (!draft) {
      setDraft(
        query.data.profiles.find((item) => item.id === query.data.activeId) ?? query.data.profiles[0] ?? emptyDraft(),
      )
    } else if (!dirty && saved && saved.revision !== draft.revision) {
      setDraft(saved)
    }
  }, [query.data, draft, saved, dirty, controlsDisabled])

  // Compare attempts rather than waiting to observe "starting", which a fast failure skips.
  useEffect(() => {
    if (torState === 'failed' && torEnabled && torAttempt >= (torAttemptAwaited ?? 0)) {
      setTorForcedOff(true)
      setTorFailure(status?.tor?.message ?? 'Tor couldn’t start. Turn Tor on to try again.')
    }
  }, [torState, torEnabled, torAttempt, torAttemptAwaited, status?.tor?.message])

  // A saved Tor connection restarts Tor on its own when data is requested. Once Tor
  // is ready again, show the switch on unless the form has been edited.
  useEffect(() => {
    if (torState === 'ready' && torForcedOff && !dirty) {
      setTorForcedOff(false)
      setTorFailure(null)
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

  const applySelection = (selection: Selection): void => {
    setRenaming(selection.kind === 'saved' && selection.rename === true)
    setNickname(selection.kind === 'saved' ? selection.profile.nickname : '')
    if (selection.kind === 'new') {
      setPreviousId(draft?.id)
      setDraft(emptyDraft())
    } else {
      setDraft(selection.profile)
    }
    setTestResult(null)
    setTorForcedOff(false)
    setTorFailure(null)
    setPendingSelection(null)
  }
  const select = (selection: Selection): void => {
    if (controlsDisabled) {
      return
    }
    if (
      selection.kind === 'saved' &&
      selection.profile.id === draft?.id &&
      selection.rename !== true &&
      selection.reload !== true
    ) {
      return
    }
    if (dirty) {
      setPendingSelection(selection)
    } else {
      applySelection(selection)
    }
  }
  const update = (value: Partial<Draft>): void => {
    setDraft((current) => (current ? { ...current, ...value } : current))
    setTestResult(null)
  }
  const handleTorChange = (enabled: boolean): void => {
    update({ torEnabled: enabled })
    setTorForcedOff(false)
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
        setDraft(remaining?.profiles.find((item) => item.id === remaining.activeId) ?? remaining?.profiles[0] ?? null)
        setTestResult(null)
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
  const run = async (operation: 'test' | 'save' | 'rename'): Promise<void> => {
    if (!draft || actionsDisabled) {
      return
    }
    setBusy(operation)
    setTestResult(null)
    try {
      const details = {
        host: draft.host.trim(),
        port: draft.port,
        protocol: draft.protocol,
        torEnabled,
      }
      if (operation === 'test') {
        await baseTrpc.settings.testElectrum.mutate(details)
        setTestResult({ ok: true, message: 'Connection successful' })
      } else if (operation === 'rename' && draft.id !== undefined && draft.revision !== undefined) {
        const renamed = await api.rename.mutate({ id: draft.id, revision: draft.revision, nickname: nickname.trim() })
        setDraft({ ...draft, nickname: renamed.nickname, revision: renamed.revision })
        setRenaming(false)
        await remember(renamed)
        toast.success('Connection renamed')
      } else if (draft.id === undefined) {
        const created = await api.create.mutate({ ...details, nickname: draft.nickname.trim() })
        setDraft(created)
        await remember(created)
        toast.success('Connection saved. Select Connect when you want to use it.')
      } else if (draft.revision !== undefined) {
        const connected = await api.connect.mutate({ id: draft.id, revision: draft.revision, connection: details })
        setDraft(connected)
        setTorForcedOff(false)
        // The saved connection now reflects the user's routing choice.
        setTorFailure(null)
        await remember(connected, true)
        refreshStatus()
        toast.success('Connection updated')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update the connection'
      setTestResult({ ok: false, message })
      if (operation !== 'test') {
        toast.error(message)
      }
    } finally {
      setBusy(null)
    }
  }
  // Connecting without Tor, including a test, asks first; saving a new connection never connects.
  const confirmRouting = (operation: 'test' | 'save'): void => {
    if (leavingTor && (operation === 'test' || !isNew)) {
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
  const canSubmit =
    (isNew || saved !== undefined) &&
    draft.host.trim() !== '' &&
    Number.isInteger(draft.port) &&
    draft.port > 0 &&
    draft.port <= 65535 &&
    (!isNew || draft.nickname.trim() !== '') &&
    (!isNew || !atLimit)
  const canReconnect = dirty || draft.id !== activeId || status?.connected === false
  const saveLabel = isNew
    ? 'Save connection'
    : dirty
      ? 'Save & Reconnect'
      : draft.id !== activeId
        ? 'Connect'
        : 'Reconnect'
  const newButton = (
    <Button
      variant="link"
      size="sm"
      onClick={() => {
        select({ kind: 'new' })
      }}
      isDisabled={atLimit || controlsDisabled || isNew}
    >
      + New connection
    </Button>
  )
  const startRename = (profile: Profile): void => {
    if (controlsDisabled) {
      return
    }
    // Switching to another profile first uses the same unsaved-edit guard as selection.
    if (profile.id !== draft.id) {
      select({ kind: 'saved', profile, rename: true })
      return
    }
    setNickname(profile.nickname)
    setRenaming(true)
    setTestResult(null)
  }
  const deleteButton = (profile: Profile): JSX.Element => (
    <Tooltip
      label={
        profile.id === activeId ? 'Connect to another profile before deleting this connection' : 'Delete connection'
      }
      shouldWrapChildren
    >
      <IconButton
        aria-label={`Delete ${profile.nickname}`}
        icon={<Trash2 size={16} aria-hidden="true" />}
        variant="ghost"
        size="sm"
        minW={8}
        w={8}
        h={8}
        color="neutral.600"
        _hover={{ color: 'error.600', bg: 'error.50' }}
        isDisabled={controlsDisabled || profile.id === activeId}
        onClick={() => {
          setDeleteError(null)
          setDeleting(profile)
        }}
      />
    </Tooltip>
  )

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
          gap: 8,
          '.connection-list': { display: 'none' },
          '@container electrum-settings (min-width: 760px)': {
            gridTemplateColumns: '480px minmax(0, 1fr)',
            gap: 10,
            '.connection-list': { display: 'block' },
            '.connection-picker': { display: 'none' },
          },
        }}
      >
        <Stack gap={5} w="full" maxW="480px" minW={0}>
          <Stack className="connection-picker" gap={1}>
            <HStack justify="space-between" flexWrap="wrap" gap={2}>
              <FormLabel htmlFor="saved-connection" m={0} textStyle="label/sm">
                Saved connection · {profiles.length} of {limit}
              </FormLabel>
              {newButton}
            </HStack>
            <HStack gap={3}>
              <Select
                id="saved-connection"
                size="sm"
                minW={0}
                value={draft.id ?? 'new'}
                isDisabled={controlsDisabled}
                onChange={(event) => {
                  const item = profiles.find((profile) => profile.id === event.target.value)
                  if (item) {
                    select({ kind: 'saved', profile: item })
                  }
                }}
              >
                {isNew && <option value="new">New connection</option>}
                {draft.id !== undefined && !saved && (
                  <option value={draft.id} disabled>
                    {draft.nickname} — Deleted
                  </option>
                )}
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nickname}
                    {item.id === activeId ? ' — Active' : ''}
                  </option>
                ))}
              </Select>
              {saved && (
                <>
                  <Button
                    variant="link"
                    size="sm"
                    isDisabled={controlsDisabled}
                    onClick={() => {
                      startRename(saved)
                    }}
                  >
                    Rename
                  </Button>
                  {deleteButton(saved)}
                </>
              )}
            </HStack>
            {atLimit && (
              <Text textStyle="text/xs" color="neutral.600">
                Maximum reached.
              </Text>
            )}
          </Stack>

          {(isNew || renaming) && (
            <FormControl>
              <FormLabel htmlFor="connection-nickname" textStyle="label/sm">
                Connection nickname
              </FormLabel>
              <Input
                id="connection-nickname"
                size="sm"
                maxLength={80}
                placeholder="e.g. Home LAN"
                value={renaming ? nickname : draft.nickname}
                isDisabled={actionsDisabled}
                onChange={(event) => {
                  if (renaming) {
                    setNickname(event.target.value)
                  } else {
                    update({ nickname: event.target.value })
                  }
                }}
              />
              <HStack mt={2} gap={3}>
                {renaming && (
                  <Button
                    size="sm"
                    colorScheme="green"
                    isLoading={busy === 'rename'}
                    isDisabled={nickname.trim() === '' || actionsDisabled}
                    onClick={() => void run('rename')}
                  >
                    Save name
                  </Button>
                )}
                <Button
                  variant="link"
                  size="sm"
                  isDisabled={actionsDisabled}
                  onClick={() => {
                    if (renaming) {
                      setRenaming(false)
                    } else {
                      const previous = profiles.find((item) => item.id === previousId) ?? active ?? profiles[0]
                      if (previous) {
                        select({ kind: 'saved', profile: previous })
                      }
                    }
                  }}
                >
                  Cancel
                </Button>
              </HStack>
            </FormControl>
          )}
          {isNew && (
            <FormControl>
              <FormLabel htmlFor="connection-starter" textStyle="label/sm">
                Start with
              </FormLabel>
              <Select
                id="connection-starter"
                size="sm"
                isDisabled={controlsDisabled}
                value={
                  ['electrum.blockstream.info', 'electrum.mempool.space'].includes(draft.host) ? draft.host : 'custom'
                }
                onChange={(event) => {
                  update({
                    host: event.target.value === 'custom' ? '' : event.target.value,
                    port: 50002,
                    protocol: 'ssl',
                    torEnabled: false,
                  })
                }}
              >
                <option value="custom">My own server</option>
                <option value="electrum.blockstream.info">Blockstream (Public)</option>
                <option value="electrum.mempool.space">Mempool.space (Public)</option>
              </Select>
            </FormControl>
          )}
          {status && (
            <HStack
              as="output"
              px={3}
              py={2}
              borderRadius="md"
              bg={status.connected ? 'green.50' : 'red.50'}
              align="start"
              gap={2}
            >
              <Circle size="8px" mt="6px" flexShrink={0} bg={status.connected ? 'green.500' : 'red.500'} />
              <Stack gap={0} minW={0}>
                <Text
                  textStyle="text/sm"
                  color={status.connected ? 'green.700' : 'red.700'}
                  fontWeight="medium"
                  overflowWrap="anywhere"
                >
                  {status.connected ? 'Connected' : 'Disconnected'}
                  {active ? ` · ${active.nickname}` : ''}
                </Text>
                <Text textStyle="text/xs" color={status.connected ? 'green.600' : 'red.600'} overflowWrap="anywhere">
                  {status.host}:{status.port} ({status.protocol.toUpperCase()}
                  {active?.torEnabled === true ? ' · Tor' : ''})
                </Text>
                {!status.connected && (
                  <Text textStyle="text/sm" color="red.700">
                    {torFailure !== null || (active?.torEnabled === true && torState === 'failed')
                      ? 'Your saved data is still on this device. Turn Tor on to try again, or choose another saved connection.'
                      : 'Your saved data is still on this device. Retry this connection or choose another saved connection.'}
                  </Text>
                )}
              </Stack>
            </HStack>
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
                  : undefined
              }
            />
          </HStack>
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
              isDisabled={draft.host.trim() === '' || controlsDisabled || torStarting}
            >
              Test Connection
            </Button>
            <Button
              size="sm"
              colorScheme="green"
              onClick={() => {
                confirmRouting('save')
              }}
              isLoading={busy === 'save'}
              isDisabled={!canSubmit || (!isNew && !canReconnect) || controlsDisabled || torStarting}
            >
              {saveLabel}
            </Button>
          </HStack>
        </Stack>
        <Box className="connection-list" as="aside" aria-label="Saved connections" minW={0}>
          <HStack justify="space-between" mb={2} flexWrap="wrap">
            <Text textStyle="label/sm">Saved connections</Text>
            <Text textStyle="text/xs" color="neutral.600">
              {profiles.length} of {limit}
            </Text>
          </HStack>
          {profiles.map((item) => (
            <HStack key={item.id} gap={1} borderBottomWidth="1px" bg={draft.id === item.id ? 'neutral.50' : undefined}>
              <Button
                variant="unstyled"
                h="auto"
                flex={1}
                minW={0}
                display="flex"
                flexDirection="column"
                alignItems="flex-start"
                justifyContent="center"
                py={3}
                px={2}
                textAlign="left"
                whiteSpace="normal"
                aria-pressed={draft.id === item.id}
                isDisabled={controlsDisabled}
                onClick={() => {
                  select({ kind: 'saved', profile: item })
                }}
              >
                <Text as="span" textStyle="label/sm" overflowWrap="anywhere">
                  {item.nickname}
                </Text>
                <Text as="span" textStyle="text/xs" color={item.id === activeId ? 'green.700' : 'neutral.600'} mt={1}>
                  {item.id === activeId ? '✓ Active' : item.torEnabled ? 'Tor' : 'Direct'}
                </Text>
              </Button>
              <Button
                variant="link"
                size="xs"
                px={1}
                isDisabled={controlsDisabled}
                onClick={() => {
                  startRename(item)
                }}
                aria-label={`Rename ${item.nickname}`}
              >
                Rename
              </Button>
              {deleteButton(item)}
            </HStack>
          ))}
          <Box mt={3}>{newButton}</Box>
          {atLimit && (
            <Text textStyle="text/xs" mt={2} color="neutral.600">
              Maximum reached.
            </Text>
          )}
        </Box>
      </Box>
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
            <Text textStyle="text/sm">This removes the saved connection. Your accounts and wallet data are kept.</Text>
            {deleting?.id === draft.id && dirty && (
              <Text textStyle="text/sm" mt={3}>
                Your unsaved changes to this connection will also be discarded.
              </Text>
            )}
            {deleting?.id === activeId && (
              <Text textStyle="text/sm" mt={3}>
                Connect to another profile before deleting the active connection.
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
