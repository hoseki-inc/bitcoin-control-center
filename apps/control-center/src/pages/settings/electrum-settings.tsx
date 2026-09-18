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
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  Tooltip,
  VStack,
} from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type RouterOutput, baseTrpc } from '../../trpc'

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

/** One form and one draft remain mounted when the saved selector changes layout. */
export function ElectrumSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.list.query(undefined, { signal }),
    refetchInterval: 10_000,
  })
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
  const saved = query.data?.profiles.find((item) => item.id === draft?.id)
  const isNew = draft !== null && !draft.id
  const dirty = draft !== null && (isNew ? Boolean(draft.host || draft.nickname) : connectionChanged(draft, saved))
  const actionsDisabled = busy !== null || deleting !== null || pendingSelection !== null
  const controlsDisabled = actionsDisabled || renaming

  useEffect(() => {
    if (!query.data || controlsDisabled) return
    if (!draft) {
      setDraft(
        query.data.profiles.find((item) => item.id === query.data.activeId) ?? query.data.profiles[0] ?? emptyDraft(),
      )
    } else if (!dirty && saved && saved.revision !== draft.revision) {
      setDraft(saved)
    }
  }, [query.data, draft, saved, dirty, controlsDisabled])

  const applySelection = (selection: Selection): void => {
    setRenaming(selection.kind === 'saved' && Boolean(selection.rename))
    setNickname(selection.kind === 'saved' ? selection.profile.nickname : '')
    if (selection.kind === 'new') {
      setPreviousId(draft?.id)
      setDraft(emptyDraft())
    } else {
      setDraft(selection.profile)
    }
    setTestResult(null)
    setPendingSelection(null)
  }
  const select = (selection: Selection): void => {
    if (controlsDisabled) return
    if (selection.kind === 'saved' && selection.profile.id === draft?.id && !selection.rename && !selection.reload)
      return
    if (dirty) setPendingSelection(selection)
    else applySelection(selection)
  }
  const update = (value: Partial<Draft>): void => {
    setDraft((current) => (current ? { ...current, ...value } : current))
    setTestResult(null)
  }
  const remember = async (profile: Profile, connected = false): Promise<void> => {
    await queryClient.cancelQueries({ queryKey })
    queryClient.setQueryData<Snapshot>(queryKey, (current) =>
      current
        ? {
            ...current,
            profiles: current.profiles.some((item) => item.id === profile.id)
              ? current.profiles.map((item) => (item.id === profile.id ? profile : item))
              : [...current.profiles, profile],
            ...(connected ? { activeId: profile.id, status: { ...current.status, ...profile, connected: true } } : {}),
          }
        : current,
    )
    void queryClient.invalidateQueries({ queryKey })
  }
  const deleteProfile = async (): Promise<void> => {
    if (!deleting || busy) return
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
    if (!draft || actionsDisabled) return
    setBusy(operation)
    setTestResult(null)
    try {
      const details = {
        host: draft.host.trim(),
        port: draft.port,
        protocol: draft.protocol,
        torEnabled: draft.torEnabled,
      }
      if (operation === 'test') {
        await baseTrpc.settings.testElectrum.mutate(details)
        setTestResult({ ok: true, message: 'Connection successful' })
      } else if (operation === 'rename' && draft.id && draft.revision) {
        const renamed = await api.rename.mutate({ id: draft.id, revision: draft.revision, nickname: nickname.trim() })
        setDraft({ ...draft, nickname: renamed.nickname, revision: renamed.revision })
        setRenaming(false)
        await remember(renamed)
        toast.success('Connection renamed')
      } else if (!draft.id) {
        const created = await api.create.mutate({ ...details, nickname: draft.nickname.trim() })
        setDraft(created)
        await remember(created)
        toast.success('Connection saved. Select Connect when you want to use it.')
      } else if (draft.revision) {
        const connected = await api.connect.mutate({ id: draft.id, revision: draft.revision, connection: details })
        setDraft(connected)
        await remember(connected, true)
        toast.success('Connection updated')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update the connection'
      setTestResult({ ok: false, message })
      if (operation !== 'test') toast.error(message)
    } finally {
      setBusy(null)
    }
  }

  if (!query.data || !draft)
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
  const { profiles, activeId, status, limit } = query.data
  const active = profiles.find((item) => item.id === activeId)
  const atLimit = profiles.length >= limit
  const canSubmit =
    (isNew || Boolean(saved)) &&
    Boolean(draft.host.trim()) &&
    Number.isInteger(draft.port) &&
    draft.port > 0 &&
    draft.port <= 65535 &&
    (!isNew || Boolean(draft.nickname.trim())) &&
    (!isNew || !atLimit)
  const canReconnect = dirty || draft.id !== activeId || !status.connected
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
      onClick={() => select({ kind: 'new' })}
      isDisabled={atLimit || controlsDisabled || isNew}
    >
      + New connection
    </Button>
  )
  const startRename = (profile: Profile): void => {
    if (controlsDisabled) return
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
          <Button size="sm" onClick={() => setPendingSelection(null)}>
            Keep editing
          </Button>
          <Button size="sm" onClick={() => applySelection(pendingSelection)}>
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
            onClick={() => select({ kind: 'saved', profile: saved, reload: true })}
          >
            Reload connection
          </Button>
        </Alert>
      )}
      {draft.id && !saved && (
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
                  if (item) select({ kind: 'saved', profile: item })
                }}
              >
                {isNew && <option value="new">New connection</option>}
                {draft.id && !saved && (
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
                  <Button variant="link" size="sm" isDisabled={controlsDisabled} onClick={() => startRename(saved)}>
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
                autoFocus
                value={renaming ? nickname : draft.nickname}
                isDisabled={actionsDisabled}
                onChange={(event) =>
                  renaming ? setNickname(event.target.value) : update({ nickname: event.target.value })
                }
              />
              <HStack mt={2} gap={3}>
                {renaming && (
                  <Button
                    size="sm"
                    colorScheme="green"
                    isLoading={busy === 'rename'}
                    isDisabled={!nickname.trim() || actionsDisabled}
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
                    if (renaming) setRenaming(false)
                    else {
                      const previous = profiles.find((item) => item.id === previousId) ?? active ?? profiles[0]
                      if (previous) select({ kind: 'saved', profile: previous })
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
                onChange={(event) =>
                  update({
                    host: event.target.value === 'custom' ? '' : event.target.value,
                    port: 50002,
                    protocol: 'ssl',
                    torEnabled: false,
                  })
                }
              >
                <option value="custom">My own server</option>
                <option value="electrum.blockstream.info">Blockstream (Public)</option>
                <option value="electrum.mempool.space">Mempool.space (Public)</option>
              </Select>
            </FormControl>
          )}
          <HStack
            px={3}
            py={2}
            borderRadius="md"
            bg={status.connected ? 'green.50' : 'red.50'}
            align="start"
            gap={2}
            role="status"
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
                {active?.torEnabled ? ' · Tor' : ''})
              </Text>
              {!status.connected && (
                <Text textStyle="text/sm" color="red.700">
                  Your saved data is still on this device. Retry this connection or choose another saved connection.
                </Text>
              )}
            </Stack>
          </HStack>
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
              onChange={(event) => update({ host: event.target.value })}
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
                onChange={(event) => update({ port: Number(event.target.value) })}
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
                onChange={(event) => update({ protocol: event.target.value as 'tcp' | 'ssl' })}
              >
                <option value="ssl">SSL</option>
                <option value="tcp">TCP</option>
              </Select>
            </FormControl>
          </HStack>
          <Text textStyle="text/sm" color={status.tor.state === 'failed' ? 'red.500' : 'neutral.600'} role="status">
            {status.tor.state === 'ready'
              ? 'Tor is ready.'
              : status.tor.state === 'starting'
                ? 'Tor is connecting. This can take up to two minutes.'
                : (status.tor.message ??
                  (status.tor.state === 'unavailable'
                    ? 'Tor is not available in this development session.'
                    : 'Tor starts when you test or connect using Tor.'))}
          </Text>
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
              isChecked={draft.torEnabled}
              isDisabled={controlsDisabled}
              onChange={(event) => update({ torEnabled: event.target.checked })}
            />
          </HStack>
          {testResult && (
            <Alert status={testResult.ok ? 'success' : 'error'}>
              <AlertDescription>{testResult.message}</AlertDescription>
            </Alert>
          )}
          <HStack gap={3} flexWrap="wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run('test')}
              isLoading={busy === 'test'}
              isDisabled={!draft.host.trim() || controlsDisabled}
            >
              Test Connection
            </Button>
            <Button
              size="sm"
              colorScheme="green"
              onClick={() => void run('save')}
              isLoading={busy === 'save'}
              isDisabled={!canSubmit || (!isNew && !canReconnect) || controlsDisabled}
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
                onClick={() => select({ kind: 'saved', profile: item })}
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
                onClick={() => startRename(item)}
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
      <AlertDialog
        isOpen={deleting !== null}
        leastDestructiveRef={cancelDeleteRef}
        finalFocusRef={hostRef}
        onClose={() => {
          if (busy !== 'delete') setDeleting(null)
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
            {deleteError && (
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
              onClick={() => setDeleting(null)}
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
