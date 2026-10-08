# Bitcoin Control Center on StartOS

> Upstream repository: https://github.com/hoseki-inc/bitcoin-control-center

Bitcoin Control Center is packaged for StartOS as a local Sentinel backend and
same-origin web application. It tracks watch-only Bitcoin accounts, exchange and
manually maintained holdings, portfolio history, and proof-of-reserves
statements. Application state remains on the StartOS server; there is no Hoseki
cloud service or hosted application backend.

## Image and container runtime

| Property      | Value                                                          |
| ------------- | -------------------------------------------------------------- |
| Image source  | Built from `start9/Dockerfile` in the upstream repository      |
| Architectures | `x86_64`, `aarch64`                                            |
| Runtime       | Node.js application serving Sentinel and the Control Center UI |
| Command       | `/usr/local/bin/docker_entrypoint.sh`                          |
| Internal port | `3400`                                                         |

The build compiles Sentinel and the production web application before StartOS
builds the multi-architecture container image. The container runs the API and UI
as one process so browser requests use the same origin.

## Volume and data layout

| Volume | Mount point | Purpose                                                                                                     |
| ------ | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `main` | `/data`     | SQLite database, encryption material, StartOS configuration, account history, settings, and statement state |

Important paths inside the volume include:

- `/data/sentinel.db` — accounts, balances, history, settings, and statement
  metadata;
- `/data/secrets/exchange-credentials.key` — the local key used to encrypt saved
  exchange credentials;
- `/data/start9/config.yaml` — configuration written by the StartOS action.

The database and encryption material belong together. Do not copy, log, or
publish either one as diagnostic data.

## Installation and first-run flow

`electrs` and `mempool` are required StartOS dependencies. Electrs should be
fully synchronized before Bitcoin Control Center is used. No separate initialization task is
required.

After the service starts:

1. Open the exported **Web Interface**.
2. Add a name under **Settings** if statements should identify their owner.
3. Add watch-only, exchange, manual, or ETF accounts under **Accounts**.
4. Allow self-custody accounts to finish synchronizing before evaluating
   balances and history.

Never enter wallet seeds or private keys. Self-custody accounts use public
descriptors or extended public keys, with supported hardware wallets used for
public-key retrieval and signing workflows.

## Configuration management

The StartOS **Configure** action sets the mempool URL and application log level.
Leave the URL blank to use an installed mempool service, or public
`https://mempool.space` when none is installed; an HTTP(S) URL overrides both.
Statements need that mempool to be running. Missing statement prices use public
mempool.space only while fallbacks are on in Settings.

Available log levels:

- Error
- Warning
- Info (default)
- Debug
- Trace

The action writes `/data/start9/config.yaml`, and the service restarts to apply it.

The StartOS build is fixed to Bitcoin mainnet and its required internal
`electrs` dependency. Desktop-only Electrum and Tor controls are intentionally
not displayed in the StartOS UI.

## Network access and interfaces

| Interface     | Port   | Protocol                | Purpose                                                                   |
| ------------- | ------ | ----------------------- | ------------------------------------------------------------------------- |
| Web Interface | `3400` | HTTP inside the package | Control Center UI, Sentinel API, health endpoint, and statement downloads |

The interface is exported through a StartOS multi-host binding. Sentinel checks
the request host and origin but does not add a second application login layer;
access control and interface exposure are therefore part of the StartOS trust
boundary.

Sentinel's allowed hosts come from the addresses enabled for this interface in
StartOS, including public and local IPs, mDNS, Tor, and custom domains. Changing
the enabled addresses or an assigned IP automatically restarts Sentinel with the
updated list. An unavailable or empty address list permits only loopback access
until StartOS supplies an enabled address. Host and origin checks remain enabled.

## Actions

| Action    | Availability       | Purpose                           |
| --------- | ------------------ | --------------------------------- |
| Configure | Any service status | Set the mempool URL and log level |

## Backups and restore

StartOS backs up and restores the complete `main` volume. This preserves the
SQLite database, saved settings, account history, and the encryption material
needed to read stored exchange credentials.

An upgrade test must verify that the package ID `hoseki-sentinel` and volume ID
`main` remain unchanged and that existing data is available after restart.

## Health checks

| Check         | Method                    | Success                                           | Failure                                   |
| ------------- | ------------------------- | ------------------------------------------------- | ----------------------------------------- |
| Web Interface | TCP port `3400` listening | Bitcoin Control Center is running and responding. | Bitcoin Control Center is not responding. |

The port check establishes that the application is serving requests. Account
synchronization additionally requires a healthy, synchronized Electrs service.

## Dependencies

| Dependency | Required | Purpose                                           |
| ---------- | -------- | ------------------------------------------------- |
| `electrs`  | Yes      | On-chain address balances and transaction history |
| `mempool`  | Yes      | Statement prices and transaction details          |

Bitcoin Control Center also makes outbound requests when the corresponding
feature is used:

- the current BTC/USD price comes from the source chosen in Settings: the
  configured mempool by default when available, otherwise Block
  (`https://pricing.bitcoin.block.xyz`), with public fallbacks unless turned off;
- statement prices and transaction enrichment use the configured mempool URL
  (public `https://mempool.space` by default); only missing prices fall back to
  public mempool.space, unless fallbacks are turned off;
- connected exchange accounts contact their selected exchange provider.

Apart from mempool, these are not StartOS package dependencies.

## Limitations and differences

1. The StartOS package supports Bitcoin mainnet only.
2. Electrum server selection and Tor controls shown by the desktop distribution
   are not available in the StartOS web interface.
3. Direct USB hardware-wallet support depends on browser capabilities and
   permissions. File and QR workflows remain device-specific alternatives.
4. Bitcoin Control Center is watch-only software. It must never receive or store
   a wallet seed or private key.

## What is unchanged from upstream

The StartOS package uses the repository's Sentinel backend and Control Center
frontend without a compatibility API or cloud intermediary. Account management,
portfolio history, hardware-wallet workflows, exchange connections, manual and
ETF holdings, and statement generation behave as documented by the upstream
application except for the distribution-specific settings described above.

## Building

Run the package build from the upstream repository root:

```bash
./start9/build.sh
```

The checked-in version graph under `start9/startos/versions/` is the package
version source of truth. The [release workflows](../README.md#releases) automate
version preparation, candidate builds, and draft releases for StartOS and desktop.

## Quick reference

```yaml
package_id: hoseki-sentinel
architectures: [x86_64, aarch64]
volumes:
  main: /data
ports:
  ui: 3400
dependencies: [electrs, mempool]
actions: [configure]
bitcoin_network: mainnet
```
