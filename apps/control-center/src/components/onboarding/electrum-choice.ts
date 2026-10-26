import { Err, Ok, Result } from '@hoseki/packages/result'
import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import type { ConnectionDetails } from '../../pages/settings/electrum-connection'
import { baseTrpc } from '../../trpc'

/** The name the introduction saves your node under, which Settings can rename. */
const NODE_NICKNAME = 'My node'

const api = baseTrpc.settings.connectionProfiles

type ProfileReference = { id: string; revision: number }

/** What the introduction's server step can do. A failure carries Sentinel's reason. */
export interface ElectrumChoice {
  /**
   * Keeps the public server the app started with, going back to it from a node connected here. Saves
   * nothing, so the notice about the public server still shows.
   */
  keepPublic: () => Promise<Result<void, Error>>
  /** Saves your node as a connection and connects to it. A failure keeps the current connection. */
  connectNode: (details: ConnectionDetails) => Promise<Result<void, Error>>
}

/** Carries out the introduction's server choice through Sentinel's saved connections. */
export function useElectrumChoice(): ElectrumChoice {
  const queryClient = useQueryClient()
  // The connection in use before a node was connected here, to go back to if the public server is
  // chosen after all, and the node itself, so new details update it rather than saving another.
  const previous = useRef<ProfileReference | null>(null)
  const node = useRef<ProfileReference | null>(null)

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['connection-profiles'] }),
      queryClient.invalidateQueries({ queryKey: ['local-settings'] }),
    ])
  }

  return {
    keepPublic: async () => {
      if (previous.current === null) {
        return Ok(undefined)
      }
      const restored = await Result.fromPromise(api.connect.mutate(previous.current))
      if (restored.isErr()) {
        return Err(restored.unwrapErr())
      }
      previous.current = null
      node.current = null
      await refresh()
      return Ok(undefined)
    },
    connectNode: async (details) => {
      if (node.current !== null) {
        const updated = await Result.fromPromise(api.connect.mutate({ ...node.current, connection: details }))
        if (updated.isErr()) {
          return Err(updated.unwrapErr())
        }
        node.current = { ...node.current, revision: updated.unwrap().revision }
        await refresh()
        return Ok(undefined)
      }
      const snapshot = await Result.fromPromise(api.list.query())
      if (snapshot.isErr()) {
        return Err(snapshot.unwrapErr())
      }
      const created = await Result.fromPromise(api.create.mutate({ ...details, nickname: NODE_NICKNAME }))
      if (created.isErr()) {
        return Err(created.unwrapErr())
      }
      const { id, revision } = created.unwrap()
      const connected = await Result.fromPromise(api.connect.mutate({ id, revision, connection: details }))
      if (connected.isErr()) {
        // Only a node that connects is worth keeping; Settings would list it as another saved connection.
        await Result.fromPromise(api.delete.mutate({ id, revision }))
        return Err(connected.unwrapErr())
      }
      const { profiles, activeId } = snapshot.unwrap()
      const active = profiles.find((profile) => profile.id === activeId)
      previous.current = active === undefined ? null : { id: active.id, revision: active.revision }
      node.current = { id, revision: connected.unwrap().revision }
      await refresh()
      return Ok(undefined)
    },
  }
}
