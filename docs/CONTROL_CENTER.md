# Bitcoin Control Center developer guide

Bitcoin Control Center has one application mode and one backend contract: the Control Center web app talks to Sentinel. StartOS and Electron are distribution targets for that same application.

## Components

| Path                   | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `apps/control-center/` | React/Vite user interface                              |
| `apps/api-sentinel/`   | Fastify/tRPC backend and SQLite storage                |
| `packages/`            | Shared Bitcoin, wallet, UI, client, and PDF code       |
| `start9/`              | StartOS SDK package and multi-architecture image build |
| `desktop/`             | Electron shell, tray integration, and bundled Tor      |

`VITE_PLATFORM=desktop` is the only frontend distribution flag. It enables desktop-only Electrum and Tor settings. StartOS supplies those settings through its service configuration.

## Develop locally

Copy Sentinel's checked-in example environment and point it at an Electrum server:

```bash
cp apps/api-sentinel/.env.example apps/api-sentinel/.env
pnpm install --frozen-lockfile
pnpm dev
```

The default ports are:

- Control Center: `4269`
- Sentinel: `3400`
- Electrum: configured through `ELECTRUM_HOST`, `ELECTRUM_PORT`, and `ELECTRUM_PROTOCOL`

To run Sentinel and the browser UI as the desktop app does, including saved Electrum connections:

```bash
pnpm dev:desktop
```

Desktop Tor behavior is only complete in a packaged Electron build because the Tor executable is bundled during packaging.

## Build the application

```bash
pnpm --filter api-sentinel build
pnpm --filter control-center build
```

Sentinel produces `apps/api-sentinel/dist/`. The web app produces `apps/control-center/dist/` using its production Sentinel environment by default.

## Build StartOS

```bash
./start9/build.sh
```

The build performs these steps:

1. Bundle Sentinel with esbuild.
2. Build the web app with same-origin `/trpc` configuration.
3. Compile the StartOS SDK scripts.
4. Build x86_64 and aarch64 Docker images.
5. Pack and verify `start9/hoseki-sentinel.s9pk`.

Version examples:

```bash
./start9/build.sh --bump patch --notes "Add custom portfolio date ranges."
./start9/build.sh --bump minor --notes "Add a substantial new account capability."
./start9/build.sh --bump revision --notes "Rebuild packaging without an app change."
./start9/build.sh --version 0.2.0:0 --notes "Set an explicit version."
```

StartOS versions use `major.minor.patch:revision`. Preserve the package ID `hoseki-sentinel`, the `main` volume, and existing configuration keys so updates remain compatible with deployed instances.

Validate the version graph and print its matching StartOS release tag with:

```bash
node start9/scripts/version.mjs check
node start9/scripts/version.mjs tag
```

Use the manually triggered **StartOS 2 - Build candidate** GitHub Actions workflow for private remote builds. It builds the exact committed version and never creates a version, tag, GitHub Release, or registry publication.

Use **StartOS 1 - Prepare version** to select a version bump. It opens a version pull request and calculates the exact tag. Edit the generated version file in that pull request to replace its required release-notes placeholder with reviewed multiline notes; CI blocks the pull request until this is done. Once the pull request is merged and its candidate is tested, **StartOS 3 - Create draft release** rebuilds from the protected default branch and creates the matching draft GitHub Release without asking anyone to type a tag. It uses the permanent signing key when configured or a temporary clean-install key otherwise. See [STARTOS_RELEASES.md](STARTOS_RELEASES.md) for the complete candidate and release model.

## Build desktop installers

```bash
./desktop/build.sh
```

The script downloads pinned-platform Tor artifacts when absent, verifies their SHA-256 hashes, builds Sentinel and the desktop frontend, installs Electron dependencies, validates the bundled `better-sqlite3` native prebuilds, and packages macOS and Windows installers under `desktop/release/`.

## Add another distribution

An Umbrel package should wrap the same two build artifacts:

- `apps/api-sentinel/dist/`
- `apps/control-center/dist/`

Keep platform behavior at the packaging/configuration boundary. Product logic belongs in Sentinel or the shared frontend, not in a fork of either application.

## Security and privacy constraints

- Store account data and credentials only in Sentinel's local SQLite database.
- Never add hosted telemetry, authentication, or billing as an implicit dependency.
- Treat exchange API credentials and descriptors as secrets in logs and errors.
- Preserve encryption and file-permission behavior when changing storage.
- Avoid network calls that are not initiated by a documented portfolio, pricing, exchange, or Electrum feature.
- Run `pnpm security:audit` and review [SECURITY_AUDIT.md](SECURITY_AUDIT.md) before a release.
