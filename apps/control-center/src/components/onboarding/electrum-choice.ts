import { Err, Ok, Result } from '@hoseki/packages/result'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import type { ConnectionDetails } from '../../pages/settings/electrum-connection'
import { type RouterOutput, baseTrpc } from '../../trpc'

/** The name the introduction saves your node under, which Settings can rename. */
const NODE_NICKNAME = 'My node'

const api = baseTrpc.settings.connectionProfiles

type ProfileReference = { id: string; revision: number }

/** A saved connection as the introduction last left it. */
type SavedConnection = ProfileReference & { details: ConnectionDetails }

type StatementSource = RouterOutput['settings']['statementSource']['source']

/** What the introduction's server step can do. A failure carries Sentinel's reason. */
export interface ElectrumChoice {
  /**
   * Uses the public server the app started with, through Tor or not, going back to it from a node
   * connected here. Without Tor and with nothing connected here, it saves nothing, so the notice about
   * the public server still shows. Statements then look up transactions on mempool.space without Tor,
   * or on the public server through Tor. A failure keeps the current connection.
   */
  keepPublic: (torEnabled: boolean) => Promise<Result<void, Error>>
  /**
   * Saves your node as a connection and connects to it, and statements look up transactions on it.
   * A failure keeps the current connection.
   */
  connectNode: (details: ConnectionDetails) => Promise<Result<void, Error>>
  /** Starts Tor without waiting, so it's ready sooner once a connection needs it. Connecting reports failures. */
  startTor: () => void
}

/** Carries out the introduction's server choice through Sentinel's saved connections. */
export function useElectrumChoice(): ElectrumChoice {
  const queryClient = useQueryClient()
  // The public server's saved connection, once looked up, to go back to it from a node or change its
  // Tor setting; and the node, so new details update it rather than saving another.
  const publicServer = useRef<SavedConnection | null>(null)
  const node = useRef<ProfileReference | null>(null)
  // Whether the public server is connected through Tor, or null while a node is. The app starts on
  // the public server without Tor.
  const publicTor = useRef<boolean | null>(false)
  // Where statements look up transactions, once saved here. Until then, mempool.space, as on any new install.
  const statementSource = useRef<StatementSource | null>(null)

  // Made once, so the introduction's steps, and their previews, aren't rebuilt on every render.
  return useMemo((): ElectrumChoice => {
    const refresh = async (): Promise<void> => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['connection-profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['local-settings'] }),
      ])
    }

    // Looked up while the public server is still the connection in use, before anything else connects.
    const findPublic = async (): Promise<Result<SavedConnection | undefined, Error>> => {
      if (publicServer.current !== null) {
        return Ok(publicServer.current)
      }
      const snapshot = await Result.fromPromise(api.list.query())
      if (snapshot.isErr()) {
        return Err(snapshot.unwrapErr())
      }
      const { profiles, activeId } = snapshot.unwrap()
      const active = profiles.find((profile) => profile.id === activeId)
      if (active === undefined) {
        return Ok(undefined)
      }
      const { id, revision, host, port, protocol, torEnabled } = active
      publicServer.current = { id, revision, details: { host, port, protocol, torEnabled } }
      return Ok(publicServer.current)
    }

    // Only a starting point: Settings changes it from then on.
    const chooseStatementSource = async (source: StatementSource): Promise<Result<void, Error>> => {
      if ((statementSource.current ?? 'mempool') === source) {
        return Ok(undefined)
      }
      const saved = await Result.fromPromise(baseTrpc.settings.setStatementSource.mutate({ source }))
      if (saved.isErr()) {
        return Err(saved.unwrapErr())
      }
      statementSource.current = source
      await queryClient.invalidateQueries({ queryKey: ['statement-source'] })
      return Ok(undefined)
    }

    const connectPublic = async (torEnabled: boolean): Promise<Result<void, Error>> => {
      if (publicTor.current === torEnabled) {
        return Ok(undefined)
      }
      const found = await findPublic()
      if (found.isErr()) {
        return Err(found.unwrapErr())
      }
      const server = found.unwrap()
      if (server === undefined) {
        return Err(new Error('The public server’s saved connection is missing. Choose a server in Settings.'))
      }
      const connection = { ...server.details, torEnabled }
      const connected = await Result.fromPromise(
        api.connect.mutate({ id: server.id, revision: server.revision, connection }),
      )
      if (connected.isErr()) {
        return Err(connected.unwrapErr())
      }
      publicServer.current = { id: server.id, revision: connected.unwrap().revision, details: connection }
      publicTor.current = torEnabled
      await refresh()
      return Ok(undefined)
    }

    const connectToNode = async (details: ConnectionDetails): Promise<Result<void, Error>> => {
      if (node.current !== null) {
        const updated = await Result.fromPromise(api.connect.mutate({ ...node.current, connection: details }))
        if (updated.isErr()) {
          return Err(updated.unwrapErr())
        }
        node.current = { ...node.current, revision: updated.unwrap().revision }
        publicTor.current = null
        await refresh()
        return Ok(undefined)
      }
      // Remembered first, to go back to if the public server is chosen after all.
      const found = await findPublic()
      if (found.isErr()) {
        return Err(found.unwrapErr())
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
      node.current = { id, revision: connected.unwrap().revision }
      publicTor.current = null
      await refresh()
      return Ok(undefined)
    }

    return {
      // Choosing Tor or your own node says privacy matters more than speed, so statements follow.
      keepPublic: async (torEnabled) => {
        const connected = await connectPublic(torEnabled)
        return connected.isErr() ? connected : chooseStatementSource(torEnabled ? 'electrum' : 'mempool')
      },
      connectNode: async (details) => {
        const connected = await connectToNode(details)
        return connected.isErr() ? connected : chooseStatementSource('electrum')
      },
      startTor: () => {
        void Result.fromPromise(baseTrpc.settings.startTor.mutate())
      },
    }
  }, [queryClient])
}
