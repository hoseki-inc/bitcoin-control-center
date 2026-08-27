# Dependency security audit

This document records the baseline dependency review performed while extracting Bitcoin Control Center from Hoseki Services. It is a point-in-time audit, not a guarantee that the dependency graph remains vulnerability-free.

## Audit baseline

Audit date: 2026-08-05

| Dependency graph          | Before                                                | After |
| ------------------------- | ----------------------------------------------------- | ----- |
| Root pnpm workspace       | 125 findings: 3 critical, 63 high, 51 moderate, 8 low | 1 low |
| Electron desktop package  | 14 findings: 1 critical, 13 high                      | 0     |
| StartOS SDK package       | 2 moderate                                            | 0     |
| StartOS container runtime | Unlocked and not independently audited                | 0     |

The upgrade synchronized relevant security work from the current Hoseki Services `main` branch, then advanced affected direct and transitive dependencies to patched versions. Important runtime upgrades include Fastify 5, React 19, React Router 8, Electron 41, `better-sqlite3` 13, Vite 8, Vitest 4, and StartOS SDK 1.5.

Run all four audits with:

```bash
pnpm security:audit
```

CI fails on new findings of moderate severity or higher. Dependabot covers the root pnpm workspace, the desktop package, the StartOS SDK and runtime packages, GitHub Actions, and the StartOS Dockerfile. Pull requests also run GitHub's dependency review action.

## Accepted residual finding

`pnpm audit` reports one low-severity `elliptic` finding for an ECDSA implementation issue. The advisory has no patched release. The package is transitive through hardware-wallet and Bitcoin compatibility libraries, including Ledger, Trezor, `bip322-js`, and browser polyfills; it is forced to the newest available 6.x release.

Removing it requires upstream changes or replacing security-sensitive wallet integrations. Treat any future patched release as a priority update, and reassess the affected call paths whenever those integrations change.

## Supply-chain controls

- Exact versions are used for direct npm dependencies.
- pnpm rejects newly published versions for seven days through `minimumReleaseAge`.
- Patched transitive versions are enforced with root pnpm overrides.
- Desktop, StartOS SDK, and StartOS container runtime lockfiles are committed and installed with `npm ci`.
- Electron application code is packaged in ASAR; Tor remains an explicit external resource, and native SQLite binaries are unpacked narrowly.
- Electron packaging uses `better-sqlite3` 13's committed Node-API prebuilds instead of running lifecycle scripts or cross-compiling native code.
- Desktop Tor archives come from the permanent official archive and are verified against hard-coded SHA-256 values taken from the Tor Project's signed checksum manifest.
- The StartOS Node base image is pinned by version and multi-architecture digest; its yq binary is pinned by version and verified separately for amd64 and arm64.
- CI and dependency review use read-only repository permissions.

## Compatibility notes

The application runs React 19 while retaining React 18 type definitions temporarily because Chakra UI 2 still depends on the older global JSX model. This is a compile-time compatibility bridge, not an additional runtime. Remove the bridge when the UI system supports React 19 types, and test that migration independently.

React Query and tRPC remain on their mutually compatible major versions. Major upgrades should be performed together rather than forced through overrides.

The production bundle includes Lottie's expression engine because two checked-in Coldcard animations use expressions. Its upstream implementation contains direct `eval`, so animation data must remain trusted, static repository content; do not render user-supplied Lottie JSON. Other Node browser polyfills are restricted to `buffer`, which removes the unrelated `vm-browserify` evaluator from the bundle.

## Release security checklist

- Run `pnpm ci` from a clean clone.
- Build and inspect both desktop installers and the StartOS package.
- Run a secret scanner against the clean public snapshot and its Git history.
- Review licenses for source dependencies, fonts, images, animations, wallet logos, and bundled Tor artifacts.
- Configure private vulnerability reporting and branch protection.
- Sign and notarize macOS releases and Authenticode-sign Windows releases.
- Publish checksums and provenance for all release artifacts.
- Review and update the pinned Tor release and its trusted hashes deliberately.
