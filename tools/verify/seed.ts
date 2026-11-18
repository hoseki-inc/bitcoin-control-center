import { Signer } from 'bip322-js'
import { readArgs } from './args'
import { SEED_ACCOUNTS, signingWif } from './chain'
import { countAccounts, sentinelClient } from './client'
import {
  HELPER,
  fail,
  ownsSentinel,
  readRunState,
  readSeedMarker,
  requireJsonFile,
  runPaths,
  selectRunId,
  wait,
  writeJson,
} from './run'

// Seeds a launched run through Sentinel's API, the calls the web app makes. Running it again on a seeded run does
// nothing; a fresh run, or a run with other data, is refused rather than changed.
// Usage: helpers/verify seed [--run <id>]

const paths = runPaths(selectRunId(readArgs({ run: { type: 'string' } }).values.run))
const state =
  requireJsonFile(readRunState(paths)) ?? fail(`Run ${paths.runId} is not running. Run ${HELPER} launch first.`)
if (!ownsSentinel(state)) {
  fail(
    `Run ${paths.runId}'s Sentinel is not running on its port, so its URL may reach another server. Clean up and launch again.`,
  )
}
if (state.fresh) {
  fail(`Run ${paths.runId} was launched with --fresh, so it stays unseeded. Launch another run to seed.`)
}
if (requireJsonFile(readSeedMarker(paths))) {
  console.log(`Run ${paths.runId} is already seeded; nothing to do.`)
  process.exit(0)
}

const client = sentinelClient(state.url)

if ((await countAccounts(client)) > 0) {
  fail(
    `Run ${paths.runId} already has accounts but no seed marker, so an earlier seed stopped partway. Launch a new run.`,
  )
}

const keystore = { wallet: null, model: null, derivationPath: null }

// Proven the way a user proves ownership in Advanced: sign the challenge message with the wallet, paste the signature.
const { verified } = SEED_ACCOUNTS
const created = await client.portalProve.registry.claims.create.singlesig.mutate({
  network: verified.account.network().toString(),
  account: verified.account.descriptor(),
  displayName: verified.displayName,
  keystore: { ...keystore, label: 'Test key' },
})
const keystoreId = created.keystores[0]?.id ?? fail('The new account has no keystore')
const challenge = await client.portalProve.registry.challenges.create.mutate({ claimId: created.claim.id })
const { signedMessage } = await client.portalProve.registry.challengeMessages.create.mutate({
  challengeId: challenge.id,
  keystoreId,
})
const wif = signingWif(signedMessage.address) ?? fail(`The test key does not own ${signedMessage.address}`)
await client.portalProve.registry.challengeMessages.complete.mutate({
  signedMessageId: signedMessage.id,
  signature: Signer.sign(wif, signedMessage.address, signedMessage.messageTextToSign),
})
const proof = await client.portalProve.registry.challenges.complete.mutate({ challengeId: challenge.id })
if (!proof.isSatisfied) {
  fail('Sentinel did not accept the ownership proof')
}

/** Adds a seeded wallet as watch-only and returns its account ID. */
async function addWatchOnly(key: 'watchSegwit' | 'watchTaproot'): Promise<string> {
  const { displayName, account } = SEED_ACCOUNTS[key]
  const watched = await client.portalProve.registry.claims.create.singlesig.mutate({
    network: account.network().toString(),
    account: account.descriptor(),
    displayName,
    trackOnly: true,
    keystore: { ...keystore, label: 'Watch-only' },
  })
  return watched.claim.id
}
const watchIds = { watchSegwit: await addWatchOnly('watchSegwit'), watchTaproot: await addWatchOnly('watchTaproot') }

// One finished statement, for January 2026, so the statement list starts with something in it.
const pending = await client.portalProve.statements.initiateGeneration.mutate({
  claimIds: [created.claim.id],
  quoteCurrency: 'USD',
  openingDate: new Date('2026-01-01T00:00:00.000Z'),
  closingDate: new Date('2026-01-31T23:59:59.999Z'),
  timezone: 'UTC',
  name: 'Verify Seed',
  address: null,
})
let statement = pending
for (let waited = 0; statement.status === 'pending' && waited < 120_000; waited += 1000) {
  await wait(1000)
  statement = await client.portalProve.statements.retrieve.query(pending.id)
}
if (statement.status !== 'completed') {
  fail(`The seeded statement ended as ${statement.status}: ${JSON.stringify(statement).slice(0, 500)}`)
}

writeJson(paths.seedFile, {
  seededAt: new Date().toISOString(),
  accounts: { verified: created.claim.id, ...watchIds },
  statements: [statement.id],
})
console.log(`Seeded run ${paths.runId}:
  ${verified.displayName} (verified) ${created.claim.id}
  ${SEED_ACCOUNTS.watchSegwit.displayName} (watch-only) ${watchIds.watchSegwit}
  ${SEED_ACCOUNTS.watchTaproot.displayName} (watch-only) ${watchIds.watchTaproot}
  Statement for January 2026: ${statement.id}`)
