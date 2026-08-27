# Bitcoin Control Center

## What is Bitcoin Control Center?

Bitcoin Control Center is a self-hosted Bitcoin portfolio tracker. It connects to your local electrs instance to fetch on-chain data, tracks your balances over time, and can generate PDF proof-of-reserves statements — all running privately on your Start9 server.

## Requirements

- **electrs** must be installed and fully synced before starting Bitcoin Control Center.

## Getting Started

1. Install and start **electrs** from the Start9 marketplace if you haven't already. Wait for it to fully sync.
2. Install Bitcoin Control Center. The electrs connection is auto-configured.
3. Open the web interface from the service page.
4. Add your Bitcoin accounts by importing xpubs or output descriptors from your hardware wallets.
5. View your portfolio dashboard with balance history charts.
6. Generate proof-of-reserves statements from the Statements page.

## Connecting Hardware Wallets

Bitcoin Control Center supports importing watch-only accounts from:

- **Ledger** — via WebUSB in the browser
- **Trezor** — via WebUSB in the browser
- **Coldcard** — via QR code or file import
- **Keystone** — via QR code

You only need to connect your hardware wallet during account setup and verification signing. Your xpub is stored locally on your Start9 server.

## Data & Privacy

All data is stored locally in a SQLite database on your Start9 server. No data leaves your device except:

- Electrum queries to your local electrs instance
- Historical BTC/USD price data from mempool.space (for statement generation)

## Backup

Backups include your SQLite database containing accounts, balance history, and generated statements. Restore will recover all data to its backed-up state.
