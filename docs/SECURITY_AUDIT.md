# Dependency security audit

This document records the baseline dependency review performed while extracting Bitcoin Control Center from Hoseki Services. It is a point-in-time audit, not a guarantee that the dependency graph remains vulnerability-free.

## Audit baseline

- Baseline audit date: 2026-08-05
- Latest remediation review: 2026-08-27
- Latest Dependabot/security review: [2026-09-08](SECURITY_REVIEW_2026-09-08.md). Current main has no moderate-or-higher npm findings, but Electron 41 is out of support and the proposed StartOS SDK update introduces high-severity advisories. Automatic security-update PRs were enabled and verified in the September 8 follow-up.

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

The 2026-08-27 review upgraded the affected `js-yaml` and `nanoid` release lines to patched versions. It also disabled automatic peer installation and removed an unused React Native/Metro dependency tree that had introduced unpatched `image-size` advisories. Runtime peers used by the application are declared explicitly instead of being supplied incidentally by optional packages.

## Accepted residual finding

`pnpm audit` reports one low-severity `elliptic` finding for an ECDSA implementation issue. The advisory has no patched release. The package is transitive through hardware-wallet and Bitcoin compatibility libraries, including Ledger, Trezor, `bip322-js`, and browser polyfills; it is forced to the newest available 6.x release.

Removing it requires upstream changes or replacing security-sensitive wallet integrations. Treat any future patched release as a priority update, and reassess the affected call paths whenever those integrations change.

## Supply-chain controls

- Exact versions are used for direct npm dependencies.
- Dependabot groups routine patch/minor version updates separately from major migrations. Electron has a dedicated version-update group covering every release level so supported-runtime updates remain visible. These groups do not apply to security updates, which stay independent.
- Coordinated major migrations, such as tRPC with React Query or Chakra with React types, require an application change and compatibility testing before their individual dependency PRs can be replaced or merged.
- Optional peers are not installed automatically; required runtime peers are declared explicitly.
- pnpm rejects newly published versions for seven days through `minimumReleaseAge`.
- Patched transitive versions are enforced with root pnpm overrides.
- Desktop, StartOS SDK, and StartOS container runtime lockfiles are committed and installed with `npm ci`.
- Electron application code is packaged in ASAR; Tor remains an explicit external resource, and native SQLite binaries are unpacked narrowly.
- Electron packaging uses `better-sqlite3` 13's committed Node-API prebuilds instead of running lifecycle scripts or cross-compiling native code.
- Desktop Tor archives come from the permanent official archive and are verified against hard-coded SHA-256 values taken from the Tor Project's signed checksum manifest.
- The StartOS Node base image is pinned by version and multi-architecture digest; its yq binary is pinned by version and verified separately for amd64 and arm64.
- Third-party GitHub Actions are pinned to immutable commit SHAs, with Dependabot tracking their release updates.
- CI and dependency review use read-only repository permissions.

## Compatibility notes

The application runs React 19 while retaining React 18 type definitions temporarily because Chakra UI 2 still depends on the older global JSX model. This is a compile-time compatibility bridge, not an additional runtime. Remove the bridge when the UI system supports React 19 types, and test that migration independently.

React Query and tRPC remain on their mutually compatible major versions. Major upgrades should be performed together rather than forced through overrides.

The production bundle includes Lottie's expression engine because two checked-in Coldcard animations use expressions. Its upstream implementation contains direct `eval`, so animation data must remain trusted, static repository content; do not render user-supplied Lottie JSON. Other Node browser polyfills are restricted to `buffer`, which removes the unrelated `vm-browserify` evaluator from the bundle.

## Release security checklist

- Run `pnpm install --frozen-lockfile` and `pnpm run ci` from a clean clone.
- Build and inspect both desktop installers and the StartOS package.
- Run a secret scanner against the clean public snapshot and its Git history.
- Review licenses for source dependencies, fonts, images, animations, wallet logos, and bundled Tor artifacts.
- Configure private vulnerability reporting and branch protection.
- Sign and notarize macOS releases and Authenticode-sign Windows releases.
- Publish checksums and provenance for all release artifacts.
- Review and update the pinned Tor release and its trusted hashes deliberately.
