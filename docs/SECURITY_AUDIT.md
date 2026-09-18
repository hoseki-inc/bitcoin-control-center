# Dependency security audit

This document records the baseline dependency review performed while extracting Bitcoin Control Center from Hoseki Services. It is a point-in-time audit, not a guarantee that the dependency graph remains vulnerability-free.

## Audit baseline

- Baseline audit date: 2026-08-05
- Latest remediation review: 2026-08-27

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

## CodeQL scans

The [CodeQL workflow](../.github/workflows/codeql.yml) scans JavaScript/TypeScript and GitHub Actions workflows on pull requests targeting `main`, pushes to `main`, and every Tuesday at 10:17 UTC. All [Dependabot schedules](../.github/dependabot.yml) are pinned to Monday at 10:17 UTC, so the CodeQL follow-up is scheduled 24 hours later. It scans the latest `main`; individual Dependabot PRs receive their own scans when opened, reopened, or updated. No file filters exclude dependency-only PRs.

This is a weekly follow-up, not a dependency on a particular Dependabot run completing. GitHub may delay scheduled jobs. Once the workflow is on `main`, an additional scan can be started from **Actions → CodeQL → Run workflow**, choosing the branch to scan.

### Activating the workflow

The repository previously used GitHub's default CodeQL setup. GitHub does not accept results from this custom workflow while default setup remains enabled. Coordinate the one-time switch when the workflow pull request is ready on GitHub:

1. Open **Settings → Advanced Security → CodeQL analysis → Switch to advanced** and confirm the transition. Use the checked-in workflow rather than adding a second generated workflow. See [GitHub's setup instructions](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning).
2. Run or rerun the workflow pull request's CodeQL checks and verify both language analyses before merging it. Keep the required `Analyze (javascript-typescript)` and `CodeQL` checks in branch protection.
3. After merging, verify the first successful scan on `main`. Update existing Dependabot PR branches with `main` to include the workflow and trigger their PR checks. A scheduled scan of `main` alone does not satisfy missing checks on an open PR.

The workflow uses the default CodeQL query suite, pins actions to immutable commits, and grants only source-read and security-result-upload permissions. JavaScript/TypeScript and Actions are analyzed without building the application or installing its dependencies. Dependabot PRs use the `pull_request` event so CodeQL can upload their results with GitHub's restricted bot token.

## Accepted residual finding

`pnpm audit` reports one low-severity `elliptic` finding for an ECDSA implementation issue. The advisory has no patched release. The package is transitive through hardware-wallet and Bitcoin compatibility libraries, including Ledger, Trezor, `bip322-js`, and browser polyfills; it is forced to the newest available 6.x release.

Removing it requires upstream changes or replacing security-sensitive wallet integrations. Treat any future patched release as a priority update, and reassess the affected call paths whenever those integrations change.

## Supply-chain controls

- Exact versions are used for direct npm dependencies.
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
