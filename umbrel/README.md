# Bitcoin Control Center on Umbrel

The Umbrel package runs the same Sentinel backend and Control Center web build as
StartOS, in one container behind Umbrel's login proxy. Application data stays in
the app's data directory on the Umbrel.

| Property      | Value                                                  |
| ------------- | ------------------------------------------------------ |
| App ID        | `bitcoin-control-center`                               |
| Image         | Built from `umbrel/Dockerfile`, runs as UID/GID 1000   |
| Architectures | `amd64` (Umbrel Home, x86 PCs), `arm64` (Raspberry Pi) |
| Data          | `${APP_DATA_DIR}/data` mounted at `/data`              |
| Port          | `3400`, behind Umbrel's login proxy                    |
| Dependencies  | `bitcoin`, `electrs`, `mempool`                        |
| Network       | Bitcoin mainnet                                        |

The package is not yet published to an Umbrel app store. Until it is, test it
with a sideload bundle.

## Build a sideload bundle

Requirements: Docker with Buildx, Node.js, and the repository's pnpm setup.

```bash
./umbrel/build.sh
```

The script builds Sentinel, the web app, and a container image for each
architecture, then writes a bundle and its checksum to `umbrel/dist/`:

```text
bitcoin-control-center-umbrel-1.0.0-sideload.<commit>.tar.gz
bitcoin-control-center-umbrel-1.0.0-sideload.<commit>.tar.gz.sha256
```

The version is the shared release version (`node start9/scripts/version.mjs
umbrel`: `1.0.0:0` is `1.0.0`, `1.0.0:1` is `1.0.0-1`) plus the source commit, so
each bundle installs as a distinct version. A `.dirty` suffix marks a build from uncommitted
changes. Use `--arch amd64` or `--arch arm64` for a faster build when you know
the target device.

## Install a sideload bundle

These steps are for the Umbrel owner and need no SSH client. Bitcoin Node,
Electrs, and mempool must already be installed from the Umbrel App Store.

1. Upload the `.tar.gz` from your computer to the Umbrel: open **Files**, go to
   **Home**, and drag the file in. The commands below read it on the Umbrel, so
   it must be uploaded first.
2. Open **Settings → Advanced settings → Terminal → umbrelOS** and run these two
   commands, one at a time, using the bundle's file name:

   ```bash
   tar -xzf ~/umbrel/home/<bundle>.tar.gz -C ~
   ```

   ```bash
   ~/bitcoin-control-center-umbrel/install.sh
   ```

   Enter the Umbrel password when asked.

3. Open **Bitcoin Control Center** from the Umbrel home screen.

Every bundle extracts to `~/bitcoin-control-center-umbrel`, so installing a newer
bundle the same way updates the app in place and keeps its data. The same folder
provides `install.sh status`, `install.sh logs`, and `install.sh uninstall`.
Uninstalling deletes the app's data. The same commands work over
`ssh umbrel@umbrel.local`.

On umbrelOS 2.0, **Settings → AI agents (MCP)** lets an AI agent check the
dependencies and read the app's status and logs. MCP cannot run commands, so the
install step still uses the Terminal.

### What the installer changes

Umbrel pulls every app image from a registry during install and update. To
install an unpublished image, `install.sh`:

1. loads the image for the device's architecture into Docker;
2. starts a temporary `registry:3` container bound to `127.0.0.1:45400`, pushes
   the image to it, and removes the registry when the script exits;
3. copies the app package into the official App Store directory under
   `~/umbrel/app-stores/`, then installs or updates it with `umbreld client`.

Umbrel replaces its App Store directory when the store receives new commits,
which removes the copied package. The installed app keeps running from its own
directory; run `./install.sh` again before the next update.

## Access and security

Umbrel's login proxy passes the browser's `Host` header to Sentinel but does
not tell apps their LAN or Tailscale addresses. The package therefore allows
`*.local`, `*.onion`, and `*.ts.net` hostnames plus any IP address
(`SENTINEL_ALLOW_IP_HOSTS=true`). Umbrel's login remains enabled in front of
the app.

## Limitations

1. The package supports Bitcoin mainnet only. Do not install it on an Umbrel
   whose Bitcoin node runs testnet, signet, or regtest.
2. While Electrs is indexing, the app opens but cannot load wallet balances or
   history. They load once Electrs accepts connections.
3. Prices and transaction details come from the mempool app on the Umbrel.
   Statement quotes can still fall back to `https://mempool.space`.
4. Bitcoin Control Center is watch-only software. It must never receive or
   store a wallet seed or private key.
