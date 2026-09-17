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

Desktop startup also adds the operating system's trusted certificate authorities to Node's existing defaults before starting Sentinel. This allows a StartOS Root CA already trusted on the computer to authenticate a direct public Electrum connection. Certificate-chain and address validation remain enabled for public endpoints. The launcher does not install authorities or modify system trust; restart the app after changing the OS trust store. StartOS and future node launchers retain their own connection configuration.

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

To start Sentinel and the live-reloading browser UI with desktop-only settings from one terminal:

```bash
corepack pnpm dev:desktop
```

Stop any existing `pnpm dev` first, then open `http://localhost:4269`. Press `Ctrl+C` to stop both processes. This uses the development database; Sentinel still requires a working Electrum connection at startup. If Sentinel is running separately, start only the frontend with `corepack pnpm --filter control-center dev:desktop`.

Electron-managed Tor, native wallet integration, and the desktop OS certificate trust setup require the Electron runtime; the browser preview does not start them.

Packaged desktop binds an available loopback HTTP port at startup. Development keeps port `3400`; either application can start first, and stopping one leaves the other running. The desktop UI and wallet permission checks follow its actual port.

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

Use the manually triggered **Release 2 - Build candidates** GitHub Actions workflow for remote StartOS, macOS ARM64, and Windows x64 builds. It builds the exact committed version and never creates a version, tag, GitHub Release, or registry publication.

Use **Release 1 - Prepare version** to select a version bump. It opens a version pull request and calculates the exact tag. Edit the generated version file in that pull request to replace its required release-notes placeholder with reviewed multiline notes; CI blocks the pull request until this is done. Once the pull request is merged and its candidate is tested, **Release 3 - Create draft release** rebuilds all three packages from one protected default-branch commit and creates the matching draft GitHub Release without asking anyone to type a tag. StartOS uses the permanent signing key when configured or a temporary clean-install key otherwise. See [STARTOS_RELEASES.md](STARTOS_RELEASES.md) for the complete candidate and release model.

## Build desktop installers

```bash
./desktop/build.sh
```

The script builds the current native platform: Apple Silicon macOS or Windows x64 (Git Bash). Use `--mac` or `--win` to select a target, or `--all` on macOS to also cross-build Windows. It downloads and verifies pinned Tor bundles, builds Sentinel and the desktop frontend, installs Electron dependencies, and validates the host's SQLite native prebuild. Installers, JSON build identity, and checksums are staged under `desktop/release/artifacts/mac/` or `desktop/release/artifacts/win/`.

The protected version graph also supplies desktop's application version, with the full StartOS packaging revision retained in filenames and metadata. For `0.2.3:1`, the Mac installer is `desktop/release/artifacts/mac/Bitcoin-Control-Center-v0.2.3_1-mac-arm64.dmg`. Desktop and StartOS can have different connection settings while sharing the same product release.

The reusable desktop workflow builds on native macOS and Windows runners for CI, candidates, and draft releases. It tests the packaged backend, SQLite, frontend assets, port selection, fixture Electrum connection, and Tor executable. Interactive installation, physical-wallet signing, and upgrades still need manual acceptance tests. Current installers use ad-hoc Mac signing without notarization and no Windows publisher signature.

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
