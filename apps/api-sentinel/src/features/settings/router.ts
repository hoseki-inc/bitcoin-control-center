import * as net from 'node:net'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { settings } from '../../db/schema'
import { protectedProcedure, router } from '../../modules/trpc/init'
import { STATEMENT_SOURCES } from '../statements'
import { type ConnectionDetails, MAX_CONNECTION_PROFILES } from './connection-profiles-store'

const READABLE_SETTINGS = new Set([
  'user_name',
  'onboarding_v1',
  'electrum_notice_v1',
  'owner_identifier',
  'electrum_host',
  'electrum_port',
  'electrum_protocol',
  'tor_enabled',
])

// Connection settings must be validated, connected and saved together through
// reconnectElectrum; individual writes could make the next launch unusable.
const WRITABLE_SETTINGS = new Set(['user_name', 'onboarding_v1', 'electrum_notice_v1', 'owner_identifier'])

function isReadableSetting(key: string): boolean {
  return READABLE_SETTINGS.has(key)
}

type ElectrumProtocol = 'tcp' | 'ssl'

interface ValidatedElectrumConnection {
  host: string
  port: number
  protocol: ElectrumProtocol
  proxy?: {
    host: string
    port: number
  }
}

function normalizeBracketedIpv6Host(host: string): string {
  if (!host.startsWith('[') && !host.endsWith(']')) {
    return host
  }
  if (!host.startsWith('[') || !host.endsWith(']')) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  const unbracketed = host.slice(1, -1)
  if (net.isIP(unbracketed) !== 6) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  return unbracketed
}

function isValidElectrumDnsHost(host: string): boolean {
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return false
  }

  const labels = host.split('.')
  return labels.every((label) => {
    return label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-')
  })
}

function validateElectrumHost(value: string): string {
  const host = normalizeBracketedIpv6Host(value.trim().toLowerCase().replace(/\.$/, ''))
  if (host.length === 0 || host.length > 253 || /[\s/@?#\\]/.test(host)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  if (host.includes(':') && net.isIP(host) !== 6) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  if (net.isIP(host) === 0 && !isValidElectrumDnsHost(host)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  return host
}

function validateElectrumPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum port' })
  }

  return value
}

function validateElectrumProtocol(value: string): ElectrumProtocol {
  if (value !== 'tcp' && value !== 'ssl') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum protocol' })
  }

  return value
}

function validateElectrumConnection(input: {
  host: string
  port: number
  protocol: ElectrumProtocol
}): ValidatedElectrumConnection {
  return {
    host: validateElectrumHost(input.host),
    port: validateElectrumPort(input.port),
    protocol: validateElectrumProtocol(input.protocol),
  }
}

function validateWritableSetting(key: string, value: string): string {
  if (!WRITABLE_SETTINGS.has(key)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Setting is not writable' })
  }

  switch (key) {
    case 'onboarding_v1': {
      if (value !== 'started' && value !== 'dismissed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid onboarding state' })
      }
      return value
    }
    // Desktop: the notice about the public Electrum server was closed. Connecting another server hides
    // it too, through the connection settings.
    case 'electrum_notice_v1': {
      if (value !== 'dismissed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum notice state' })
      }
      return value
    }
    case 'user_name':
    case 'owner_identifier': {
      if (value.length > 200) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Setting value is too long' })
      }
      return value
    }
  }

  throw new TRPCError({ code: 'FORBIDDEN', message: 'Setting is not writable' })
}

// ─── Desktop saved connections ──────────────────────────────────────────────

const connectionDetailsInput = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65_535),
  protocol: z.enum(['tcp', 'ssl']),
  // Required: a missing Tor setting must never default to direct for a saved connection.
  torEnabled: z.boolean(),
})
const profileReferenceInput = z.object({ id: z.string().uuid(), revision: z.number().int().positive() })
const nicknameInput = z
  .string()
  .trim()
  .min(1, 'Enter a nickname')
  .max(80, 'Use 80 characters or fewer for the nickname')

function profileDetails(input: z.infer<typeof connectionDetailsInput>): ConnectionDetails {
  const connection = validateElectrumConnection(input)
  if (connection.host.endsWith('.onion') && !input.torEnabled) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Onion addresses require Tor' })
  }
  return { ...connection, torEnabled: input.torEnabled }
}

const desktopConnectionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.app.connectionProfiles) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Saved connections are only available in the desktop app' })
  }
  return next({ ctx: { ...ctx, profiles: ctx.app.connectionProfiles } })
})

const connectionProfilesRouter = router({
  list: desktopConnectionProcedure.query(async ({ ctx }) => ({
    profiles: await ctx.profiles.list(),
    activeId: (await ctx.profiles.getActiveId()) ?? null,
    limit: MAX_CONNECTION_PROFILES,
  })),

  // Saving, renaming, and deleting never connect; only connect changes the active server.
  create: desktopConnectionProcedure
    .input(connectionDetailsInput.extend({ nickname: nicknameInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.profiles.create({ ...profileDetails(input), nickname: input.nickname })
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      return result.unwrap()
    }),

  rename: desktopConnectionProcedure
    .input(profileReferenceInput.extend({ nickname: nicknameInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.profiles.rename(input, input.nickname)
      if (result.isErr()) {
        throw new TRPCError({ code: 'CONFLICT', message: result.unwrapErr().message })
      }
      return result.unwrap()
    }),

  delete: desktopConnectionProcedure.input(profileReferenceInput).mutation(async ({ ctx, input }) => {
    const result = await ctx.profiles.delete(input)
    if (result.isErr()) {
      throw new TRPCError({ code: 'CONFLICT', message: result.unwrapErr().message })
    }
    return { id: input.id }
  }),

  connect: desktopConnectionProcedure
    .input(profileReferenceInput.extend({ connection: connectionDetailsInput.optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.connectProfile(
        input,
        input.connection ? profileDetails(input.connection) : undefined,
      )
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const connected = (await ctx.profiles.list()).find((profile) => profile.id === input.id)
      if (!connected) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This saved connection no longer exists' })
      }
      return connected
    }),
})

export const settingsRouter = router({
  connectionProfiles: connectionProfilesRouter,
  get: protectedProcedure.input(z.object({ key: z.string() })).query(async ({ ctx, input }) => {
    if (!isReadableSetting(input.key)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Setting is not readable' })
    }

    const [row] = await ctx.app.database
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, input.key))
    return row?.value ?? null
  }),

  update: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const value = validateWritableSetting(input.key, input.value)
      await ctx.app.database
        .insert(settings)
        .values({ key: input.key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
    }),

  /** Where new statements look up transactions. Only desktop can choose. */
  statementSource: protectedProcedure.query(async ({ ctx }) => ({
    selectable: ctx.app.statementService.sourceSelectable,
    source: await ctx.app.statementService.sourceChoice(),
  })),

  setStatementSource: protectedProcedure
    .input(z.object({ source: z.enum(STATEMENT_SOURCES) }))
    .mutation(async ({ ctx, input }) => {
      const saved = await ctx.app.statementService.setSourceChoice(input.source)
      if (saved.isErr()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: saved.unwrapErr().message })
      }
    }),

  /** A newer desktop release, once the daily check finds one. */
  releaseCheck: protectedProcedure.query(({ ctx }) => ctx.app.releaseCheckService.status()),

  electrumStatus: protectedProcedure.query(({ ctx }) => {
    const { host, port, protocol } = ctx.app.electrumConfig
    // Checks run only while a page shows the status; the result appears on its next poll.
    ctx.app.electrumClient.checkReachable(30_000)
    return {
      // Reachability, not an open socket: servers close idle sockets between requests.
      connected: ctx.app.electrumClient.isReachable(),
      // Lets the page say "Connecting…" rather than "Disconnected" while the first attempt runs;
      // background retries during an outage don't count.
      connecting: ctx.app.electrumClient.isConnecting(),
      host,
      port,
      protocol,
      tor: ctx.app.getTorStatus(),
    }
  }),

  startTor: protectedProcedure.mutation(({ ctx }) => ctx.app.startTor()),

  testElectrum: protectedProcedure
    .input(
      z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65_535),
        protocol: z.enum(['tcp', 'ssl']),
        // Required, so a test never runs direct just because the Tor setting was left out.
        torEnabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prepared = ctx.app.prepareElectrumConfig(validateElectrumConnection(input), input.torEnabled)
      if (prepared.isErr()) {
        throw new Error(prepared.unwrapErr().message)
      }
      const config = prepared.unwrap()
      const { ElectrumClient } = await import('@hoseki/packages/clients/electrum')
      // Tor connections bring their own longer limit.
      const testClient = new ElectrumClient({
        requestTimeout: 15_000,
        ...config,
      })
      const result = await testClient.connect()
      testClient.disconnect()
      if (result.isErr()) {
        throw new Error(result.unwrapErr().message)
      }
      return { success: true, version: result.unwrap() }
    }),

  reconnectElectrum: protectedProcedure
    .input(
      z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65_535),
        protocol: z.enum(['tcp', 'ssl']),
        torEnabled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prepared = ctx.app.prepareElectrumConfig(validateElectrumConnection(input), input.torEnabled)
      if (prepared.isErr()) {
        throw new Error(prepared.unwrapErr().message)
      }
      const result = await ctx.app.reconnectElectrum(prepared.unwrap())
      if (result.isErr()) {
        throw new Error(result.unwrapErr().message)
      }
    }),
})
