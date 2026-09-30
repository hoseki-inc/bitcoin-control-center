import {
  Button,
  FormLabel,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@chakra-ui/react'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { Trash2Icon } from 'lucide-react'
import { z } from 'zod'
import { type RouterInput, transformer } from '../../trpc'

// ─── Data ────────────────────────────────────────────────────────────────────

const SavedConnectionSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  host: z.string(),
  port: z.number(),
  protocol: z.enum(['tcp', 'ssl']),
  torEnabled: z.boolean(),
  revision: z.number(),
})
export type SavedConnection = z.infer<typeof SavedConnectionSchema>

const SavedConnectionsSchema = z.object({
  profiles: z.array(SavedConnectionSchema),
  activeId: z.string().nullable(),
  limit: z.number(),
})
export type SavedConnections = z.infer<typeof SavedConnectionsSchema>

/** The Electrum form edits either a new connection or one saved connection. */
export type ConnectionSelection = { kind: 'new' } | { kind: 'saved'; id: string }

export const SAVED_CONNECTIONS_QUERY_KEY = ['saved-connections']

export const ErrorResponseSchema = z.object({
  error: z.object({
    json: z.object({ message: z.string() }).optional().catch(undefined),
    message: z.string().optional().catch(undefined),
  }),
})
const ResponseSchema = z.object({ result: z.object({ data: z.object({ json: z.unknown() }) }) })

type ConnectionInputs = RouterInput['settings']['connectionProfiles']

/** Calls a saved-connection procedure; a failure carries the server's message when it sent one. */
async function request<T>(
  procedure: string,
  init: RequestInit | undefined,
  schema: z.ZodType<T>,
  fallback: string,
): Promise<Result<T, Error>> {
  const baseUrl = import.meta.env.VITE_BACKEND_API_URL ?? ''
  let response: Response
  try {
    response = await fetch(`${baseUrl}/settings.connectionProfiles.${procedure}`, init)
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(fallback))
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = parseUnknown(ErrorResponseSchema, body).unwrapOr(null)
    return Err(new Error(failure?.error.json?.message ?? failure?.error.message ?? fallback))
  }
  const data = parseUnknown(ResponseSchema, body).andThen((parsed) => parseUnknown(schema, parsed.result.data.json))
  return data.isOk() ? Ok(data.unwrap()) : Err(new Error(fallback))
}

async function mutate<K extends keyof ConnectionInputs, T>(
  procedure: K,
  input: ConnectionInputs[K],
  schema: z.ZodType<T>,
  fallback: string,
): Promise<Result<T, Error>> {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transformer.serialize(input)),
  }
  return request(procedure, init, schema, fallback)
}

/** Saves a connection without connecting to it. */
export async function createConnection(input: ConnectionInputs['create']): Promise<Result<SavedConnection, Error>> {
  return mutate('create', input, SavedConnectionSchema, 'Could not save the connection')
}

/** Saves any edits, connects, and makes the connection active. */
export async function connectConnection(input: ConnectionInputs['connect']): Promise<Result<SavedConnection, Error>> {
  return mutate('connect', input, SavedConnectionSchema, 'Failed to reconnect')
}

export async function renameConnection(input: ConnectionInputs['rename']): Promise<Result<SavedConnection, Error>> {
  return mutate('rename', input, SavedConnectionSchema, 'Could not rename the connection')
}

export async function deleteConnection(input: ConnectionInputs['delete']): Promise<Result<void, Error>> {
  const result = await mutate('delete', input, z.object({ id: z.string() }), 'Could not delete the connection')
  return result.map(() => undefined)
}

export function useSavedConnections(): UseQueryResult<SavedConnections> {
  return useQuery({
    queryKey: SAVED_CONNECTIONS_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const result = await request('list', { signal }, SavedConnectionsSchema, 'Could not load saved connections')
      if (result.isErr()) {
        throw result.unwrapErr()
      }
      return result.unwrap()
    },
    // Another window can change saved connections.
    refetchInterval: 10_000,
  })
}

// ─── Picker ──────────────────────────────────────────────────────────────────

export function ConnectionPicker({
  connections,
  selection,
  isDisabled,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  connections: SavedConnections
  selection: ConnectionSelection | null
  isDisabled: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (connection: SavedConnection) => void
  onDelete: (connection: SavedConnection) => void
}): JSX.Element {
  const { profiles, activeId, limit } = connections
  const isNew = selection?.kind === 'new'
  const selectedId = selection?.kind === 'saved' ? selection.id : null
  const selected = profiles.find((profile) => profile.id === selectedId)
  const atLimit = profiles.length >= limit
  const isActive = selected?.id === activeId

  return (
    <Stack gap={1} w="full">
      <HStack justify="space-between" gap={2} flexWrap="wrap">
        <FormLabel htmlFor="saved-connection" textStyle="text/sm" mb={0}>
          Saved connection · {profiles.length} of {limit}
        </FormLabel>
        {!isNew && !atLimit && (
          <Button variant="link" size="sm" onClick={onNew} isDisabled={isDisabled}>
            New connection
          </Button>
        )}
      </HStack>
      <HStack gap={2}>
        <Select
          id="saved-connection"
          size="sm"
          minW={0}
          value={isNew ? 'new' : (selectedId ?? '')}
          isDisabled={isDisabled}
          onChange={(event) => {
            if (event.target.value !== 'new') {
              onSelect(event.target.value)
            }
          }}
        >
          {isNew && <option value="new">New connection</option>}
          {selectedId !== null && !selected && (
            <option value={selectedId} disabled>
              Deleted connection
            </option>
          )}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.id === activeId ? `${profile.nickname} (active)` : profile.nickname}
            </option>
          ))}
        </Select>
        {selected && (
          <>
            <Button
              variant="link"
              size="sm"
              isDisabled={isDisabled}
              onClick={() => {
                onRename(selected)
              }}
            >
              Rename
            </Button>
            <Tooltip
              label={isActive ? 'Connect to another saved connection before deleting this one' : 'Delete connection'}
              shouldWrapChildren
            >
              <IconButton
                aria-label={`Delete ${selected.nickname}`}
                icon={<Trash2Icon size={16} aria-hidden />}
                variant="ghost"
                size="sm"
                isDisabled={isDisabled || isActive}
                onClick={() => {
                  onDelete(selected)
                }}
              />
            </Tooltip>
          </>
        )}
      </HStack>
      {atLimit && (
        <Text textStyle="text/xs" color="neutral.600">
          You can save up to {limit} connections. Delete one to add another.
        </Text>
      )}
    </Stack>
  )
}

// ─── Deletion ────────────────────────────────────────────────────────────────

export function DeleteConnectionDialog({
  connection,
  discardsChanges,
  error,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  connection: SavedConnection | null
  discardsChanges: boolean
  error: string | null
  isDeleting: boolean
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <Modal
      isOpen={connection !== null}
      onClose={() => {
        if (!isDeleting) {
          onCancel()
        }
      }}
      closeOnEsc={!isDeleting}
      closeOnOverlayClick={!isDeleting}
      isCentered
    >
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalHeader overflowWrap="anywhere">Delete “{connection?.nickname}”?</ModalHeader>
        <ModalBody>
          <Text textStyle="text/sm" color="neutral.700">
            This removes the saved connection. Your accounts and wallet data are kept.
          </Text>
          {discardsChanges && (
            <Text textStyle="text/sm" color="neutral.700" mt={3}>
              Your unsaved changes to this connection will also be discarded.
            </Text>
          )}
          {error !== null && (
            <Text role="alert" textStyle="text/sm" color="red.700" mt={3}>
              {error}
            </Text>
          )}
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="outline" flex={1} isDisabled={isDeleting} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="error" flex={1} isLoading={isDeleting} onClick={onConfirm}>
            Delete connection
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
