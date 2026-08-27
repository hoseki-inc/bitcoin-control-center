import { VersionInfo } from '@start9labs/start-sdk'

export const v0_1_0_1 = VersionInfo.of({
  version: '0.1.0:1',
  releaseNotes:
    'This branch fixes self-custody portfolio history for Sentinel/Start9.\n\n- Reworked self-custody chart history to use balance snapshots as the source of truth.\n- Added lazy Electrum backfill for missing self-custody history ranges.\n- Records transaction-time balance snapshots so transfers out and multiple same-day movements show correctly.\n- Added versioned  metadata to track completed history ranges without deleting existing snapshots.\n- Fixed wallet sync UI so the spinner stays active until history is complete, then shows a one-time green check.\n- Replaced slow verbose Electrum transaction calls with raw transaction fetching and local parsing.\n- Verified Savings Wallet, SEP IRA, and Long-term Savings all reached synced status in the live Sentinel API.\n- Added Start9 version tooling for controlled  bumps during package builds.',
  migrations: {},
})
