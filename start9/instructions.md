# Bitcoin Control Center

## Documentation

- [Bitcoin Control Center documentation](https://help.hoseki.app) — product and
  account workflow guidance.

## Before you begin

Bitcoin Control Center requires Electrs for balances and transaction history.
Wait until Electrs is running and fully synchronized before relying on portfolio
data.

Bitcoin Control Center is watch-only software. Never enter a wallet seed or
private key. Import only public descriptors or extended public keys, and approve
signatures on the hardware wallet itself.

## Set up your portfolio

1. Open the **Web Interface** from the Bitcoin Control Center service page.
2. Open **Settings**, enter the name that should appear on generated statements,
   and save it.
3. Open **Accounts** and select **Add Account**.
4. Choose the appropriate account type and follow the on-screen import or
   connection steps.
5. Wait for self-custody accounts to finish synchronizing before checking their
   history.

Supported account workflows include watch-only Bitcoin accounts, supported
hardware wallets, supported exchanges, manually maintained Bitcoin balances,
and Bitcoin ETF holdings.

Direct hardware-wallet connections depend on browser USB support and permission.
Use a supported Chromium-based browser when a workflow connects directly to a
device. Coldcard and Keystone workflows can use their supported file or QR
methods.

## Review balances and history

Use **Home** for the current portfolio summary and recent statements. Use
**Portfolio** for the detailed balance history. If a newly added self-custody
account is still synchronizing, allow it to finish before treating charts or
historical totals as complete.

Exchange accounts contact the selected provider when they refresh. BTC/USD price
and transaction enrichment in the StartOS package currently use mempool.space.

## Generate a statement

1. Select **Generate Statement** from Home, or open **Statements** and create a
   statement.
2. Select the accounts and statement options you want to include.
3. Complete any requested proof-of-control signatures on the relevant hardware
   wallets.
4. Wait for generation to finish, then review and download the statement.

A generated statement reflects the selected accounts and the data available at
generation time. Confirm that account synchronization and exchange refreshes are
complete first.

## Configure logging

Use the StartOS **Configure** action to change the log level. **Info** is the
normal setting. Use **Debug** or **Trace** only while diagnosing a problem, then
restart the service. Return to **Info** when finished to reduce unnecessary log
detail.

Before sharing logs, remove descriptors, extended public keys, exchange account
details, credentials, and other identifying information.

## Backups

Use the normal StartOS backup flow for Bitcoin Control Center. Its `main` volume
contains the database and the local encryption material needed for saved
exchange credentials, so they are backed up and restored together.

After restoring, start the service and confirm that accounts, history, settings,
and exchange connections are available before deleting older backups.

## Troubleshooting

### Balances or history do not update

Confirm that Electrs is running and fully synchronized. Restart Bitcoin Control
Center after Electrs is healthy, then allow account synchronization to finish.

### The web interface is not ready

Check the service health result and logs. If the service repeatedly restarts,
return logging to **Info** after collecting the minimum information needed to
identify the error.

### A hardware wallet does not connect

Use a Chromium-based browser, connect the device directly to the computer running
the browser, unlock it, open the appropriate Bitcoin application, and grant the
browser permission when prompted. If the wallet supports a file or QR workflow,
use that method when direct browser access is unavailable.

### A restored exchange account needs attention

Open the account and follow the reconnect prompt. Do not place API credentials in
logs or support requests.
