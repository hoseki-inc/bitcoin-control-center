# September 8, 2026 security and Dependabot review

## Decision

No critical, high, or moderate npm advisory was found in the current `main` dependency graphs. There is one previously documented low-severity `elliptic` advisory without a patched release. This is not an all-clear for merging the open PRs: the desktop runtime is out of support and the StartOS SDK update introduces high-severity advisories. Automatic security-update PRs were disabled during the initial review and were enabled in the authorized follow-up below.

Prioritize a supported Electron runtime through PR #4 and hold PR #5. PR #3 is a reasonable maintenance candidate. Split the large production and development groups into compatible updates and deliberate major migrations. Keep StartOS on a supported Node LTS line instead of merging Node 26 solely because its version is newer.

The initial review changed documentation only. In a subsequent user-authorized action on September 8, Dependabot security updates were enabled. GitHub returned `enabled: true`, `paused: false`, and repository security settings independently returned `status: enabled`. No dependency changes, PR comments, approvals, merges, commits, or pushes were made.

## Scope and revision

- Review date: September 8, 2026.
- Repository: `hoseki-inc/bitcoin-control-center`.
- Baseline: `356beda13492480191839bac882e1a6f8dfef23b`, the current `origin/main` when fetched.
- Review branch: `september-8th-security-review`.
- The prior local-only `main` documentation commit, `c2c3a89`, was preserved on `main-before-september-8th-security-review`. The existing local `AGENTS.md` edit was restored.
- Reviewed all six open Dependabot PRs: manifests, lockfile changes, current registry audits, CI and dependency-review results, runtime support, distribution boundaries, and relevant application usage.
- Queried repository security settings, branch protection, Dependabot alerts, CodeQL alerts, and secret-scanning alert metadata. No secret values were requested.

| PR                                                                  | Reviewed head                              | Scope                                      | Decision                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| [#4](https://github.com/hoseki-inc/bitcoin-control-center/pull/4)   | `451f4ce43e755ba8451cf6cb1e4981bd1cdf491e` | Electron, desktop PDF renderer, TypeScript | Priority upgrade; refresh and test packaged applications before merge    |
| [#3](https://github.com/hoseki-inc/bitcoin-control-center/pull/3)   | `5b5d81b328c6e4dbf9cc991a8cc5b5d9276ce352` | StartOS PDF renderer                       | Suitable maintenance candidate after refresh and distribution validation |
| [#5](https://github.com/hoseki-inc/bitcoin-control-center/pull/5)   | `9a2421a84dd0ed651172bd0a4d74954a1e653692` | StartOS SDK and build tools                | Block: new high advisories and invalid lockfile                          |
| [#42](https://github.com/hoseki-inc/bitcoin-control-center/pull/42) | `62ce3169a341d1ff9fe7a04d838533fff6acc9ed` | 40 production updates                      | Block as grouped; split major migrations                                 |
| [#41](https://github.com/hoseki-inc/bitcoin-control-center/pull/41) | `49c9fdf55d2aa53f2b9310edd365f0cbd8580ca0` | 26 development updates                     | Block as grouped; formatting fails before later checks                   |
| [#16](https://github.com/hoseki-inc/bitcoin-control-center/pull/16) | `15643ce267ac42848d06ea4b1bf69e4a7a42a790` | StartOS Node 22 to 26                      | Hold; retain supported LTS or plan a tested LTS migration                |

All six PRs were `BEHIND` at the final status query. Existing green checks apply to their earlier revisions and bases; they do not validate integration with the latest Ledger/multisig fix on `main`.

## Current dependency and alert results

Audits include development dependencies. Counts below are affected package findings, not a claim about exploitability or the number of CVEs.

| Graph                                | Critical | High | Moderate | Low |
| ------------------------------------ | -------- | ---- | -------- | --- |
| Main root pnpm workspace             | 0        | 0    | 0        | 1   |
| Main desktop npm package             | 0        | 0    | 0        | 0   |
| Main StartOS SDK npm package         | 0        | 0    | 0        | 0   |
| Main StartOS runtime npm package     | 0        | 0    | 0        | 0   |
| PR #42 proposed root graph           | 0        | 0    | 0        | 1   |
| PR #41 proposed root graph           | 0        | 0    | 0        | 1   |
| PR #5 proposed StartOS SDK graph     | 0        | 2    | 0        | 0   |
| PR #4 proposed desktop graph         | 0        | 0    | 0        | 0   |
| PR #3 proposed StartOS runtime graph | 0        | 0    | 0        | 0   |

PR #16 changes only the Docker base image; npm audits cannot assess that image's operating-system packages or Node binary.

GitHub reported one open Dependabot alert, for `elliptic`, zero open code-scanning alerts, and zero open secret-scanning alerts. These are the scanner results available on the review date, not proof that no vulnerabilities or secrets exist.

### Existing low-severity elliptic finding

`elliptic@6.6.1` remains affected by [GHSA-848j-6mx2-7j84 / CVE-2025-14505](https://github.com/advisories/GHSA-848j-6mx2-7j84). The advisory lists no patched version. The dependency tree includes Ledger, Trezor, `bip322-js`, and development browser-polyfill paths. Both root Dependabot groups retain the finding.

Continue tracking the advisory and upstream replacements. A dependency path alone does not establish exploitation; this review did not prove every affected cryptographic operation unreachable. Avoid replacing wallet cryptography through broad overrides simply to silence the audit.

## Findings and required actions

### P1: The shipped desktop runtime is outside Electron security support

`desktop/package.json` pins Electron `41.10.4`. Electron 41 reached end of life on August 25, 2026. Electron supports its latest three stable major lines; npm's zero-vulnerability result does not establish continued Chromium/V8 security coverage. [Electron schedule](https://releases.electronjs.org/schedule), [support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

PR #4 upgrades to `44.2.0`, a supported release with Chromium and Node updates. Treat the runtime upgrade as the priority security maintenance item. It also includes PDF renderer `4.9.0` and TypeScript `7.0.2`; consider separating the compiler change to keep runtime validation focused. [Electron 44.2.0 release notes](https://releases.electronjs.org/release/v44.2.0).

Electron 44 requires macOS 13 or later. Confirm that support decision and state the minimum OS in packaging/release documentation. If macOS 12 must remain supported, evaluate the latest supported Electron 43 release as an interim path with its own end-of-life deadline. Windows packaging currently targets x64, so removal of 32-bit Electron artifacts does not change that configured target. [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes).

Local evidence for #4:

- Exact lockfile installation with `npm ci --ignore-scripts` passed.
- Desktop TypeScript checking with the proposed compiler and Electron declarations passed against current `main` desktop source.
- The locked native SQLite package opened an in-memory database and executed a query under Node 22.23.2.
- Current application templates generated custom, monthly, and combined statement PDFs using the proposed runtime dependencies.
- The recorded GitHub CI and dependency review passed, but the branch is behind `main`.

Still required: build and launch packaged macOS and Windows applications; validate SQLite in Electron itself, Tor startup, WebHID/hardware-wallet connection and signing, PDF output, external links, tray behavior, and shutdown. Local Node smoke tests and TypeScript checks do not execute Electron's Chromium runtime. The existing PR CI does not build installers.

### P1, resolved: Automatic Dependabot security updates were disabled

The repository API returned `security_and_analysis.dependabot_security_updates.status = disabled`. The weekly version-update configuration exists, and alerts are present, but automatic security-remediation PRs are not enabled.

Enable Dependabot security updates in repository settings. This is a separate control from the weekly version-update schedules in `.github/dependabot.yml`. Preserve the moderate-or-higher audit gate and avoid burying urgent security fixes inside unrelated major upgrades. [GitHub Dependabot configuration reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Follow-up completed September 8, 2026: enabled at the user's request and verified through both the automated-security-fixes endpoint and repository security settings. This enables automatic security-fix PR creation; it does not enable automatic merging.

### P1: PR #5 introduces high-severity vulnerabilities and cannot install reproducibly

The current StartOS SDK `1.5.3` graph audits clean. The proposed `2.0.9` graph introduces vulnerable dependencies bundled inside the SDK tarball:

| Package in SDK bundle | Locked version(s) | Required patched release line            | Advisories                                                                                                                                                                                                                   |
| --------------------- | ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brace-expansion`     | `1.1.15`, `5.0.6` | At least `1.1.18`, `5.0.9`, respectively | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `js-yaml`             | `4.2.0`           | At least `4.3.1`                         | [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)                                                                           |

These are denial-of-service advisories affecting brace expansion or YAML processing. The copies are marked `inBundle` under the SDK's ESLint/type-checking dependencies. They are in the StartOS SDK/build graph, not the independently installed Sentinel container runtime. This review did not establish a remotely reachable exploit in the shipped service.

The dependency-review job reports the brace-expansion vulnerabilities; the fresh npm audit additionally identifies js-yaml. The SDK declares bundled `eslint`, `typescript-eslint`, and `@start9labs/start-core`. Root pnpm overrides do not govern this separate npm installation. Do not assume adding a root override repairs bundled tarball contents: verify the actual installed files or use an upstream release that fixes the bundle.

Independently, [CI fails during installation](https://github.com/hoseki-inc/bitcoin-control-center/actions/runs/34166181184): `npm ci` reports `Missing: typescript@6.0.3 from lock file`. No later build or SDK compatibility check was reached.

Keep SDK `1.5.3` for now. For a replacement PR, select a corrected SDK release or verified packaging fix, regenerate its lockfile using the repository's supported runtime, then require a clean install, fresh audit, SDK type check, SDK bundle build, and an actual StartOS install/upgrade test. Preserve manifest ID `hoseki-sentinel` and volume `main` throughout.

### P2: PR #42 combines incompatible product and cryptography migrations

The proposed root graph has no new moderate-or-higher advisory, but [CI fails in `pnpm check`](https://github.com/hoseki-inc/bitcoin-control-center/actions/runs/34167899814) with extensive application, schema, and UI type errors. No tests or production build ran afterward.

The group simultaneously changes Chakra 2 to 3, Zod 3 to 4, tRPC 10 to 11, React Query 4 to 5, Ledger Bitcoin integration 10 to 11, descriptor/secp256k1/BIP32/BIP322/ECPair libraries, logging, and other utilities. Examples in the actual failure log include removed Chakra exports, incompatible Zod issue structures, and changed router input types. This is an application migration, not an emergency audit remediation.

Split out compatible patch/minor candidates and test them independently. Keep tRPC and React Query coordinated. Handle Chakra and React type migration together. Treat descriptor, key derivation, signature encoding, and hardware-wallet upgrades as a separate review with signing/verification vectors and physical-device tests. Retain the latest main Ledger/multisig regression coverage when refreshing these changes.

### P2: PR #41's formatter failure hides later migration risk

[CI stops at formatting](https://github.com/hoseki-inc/bitcoin-control-center/actions/runs/34167117936), reporting 13 files under the proposed Prettier version. Its lint, type-check, test, and build steps were not executed. Do not interpret the failure as purely cosmetic.

The group also upgrades TypeScript 5 to 7, ESLint 9 to 10, Vitest 4 to 5, Node types 22 to 26, and React types 18 to 19. The current security audit explicitly documents retaining React 18 types for Chakra 2 compatibility. Updating them in isolation needs a real compatibility review. Node 26 types also exceed the repository's Node 22 runtime target.

Separate formatter churn from compiler, lint, and test-runner migrations. Keep runtime type declarations aligned with the supported Node runtime. Same-major tooling updates can be evaluated in a smaller PR; there is no current high/critical root advisory requiring this whole group.

### P2: PR #16 leaves the LTS line without validating the container

The PR replaces the version-and-digest-pinned Node `22.23.2-bookworm-slim` base with `26.8.1-bookworm-slim`, retaining immutable digest pinning. Node 26 is Current, while Node 22 remains LTS; Node recommends Active or Maintenance LTS for production. The installed Node 22.23.2 is a security release. [Node release status](https://nodejs.org/en/about/previous-releases), [22.23.2 release notes](https://nodejs.org/en/blog/release/v22.23.2).

The green CI result does not test this change: normal PR CI reads `.nvmrc` and builds JavaScript on the host; it does not build or execute the Dockerfile. StartOS container/package builds are in a manually dispatched candidate workflow.

Keep Node 22's security-patched release line and reviewed digest, or plan a coordinated move to Node 24 LTS. Before any base-image update, scan and run both target architectures with native SQLite, statement generation, startup, health checks, and shutdown. No container vulnerability scan or multi-architecture execution was performed in this review.

### PR #3: PDF maintenance candidate, with a runtime coverage caveat

This changes only the StartOS runtime PDF renderer from `4.3.2` to `4.9.0` and its lockfile. The proposed graph audits clean. A clean isolated installation succeeded, and current custom, monthly, and combined statement templates generated PDFs using the proposed dependencies and checked-in fonts.

The renderer remains `4.3.2` in the root workspace unless separately updated. It is external to Sentinel's bundle, so root tests/builds run against a different implementation from the proposed packaged runtime. Align or explicitly validate the root, desktop, and StartOS versions together. Refresh the PR and validate a StartOS candidate before release. No urgent security advisory was identified that requires this PDF version jump by itself.

## Coverage and supply-chain controls

Controls verified in the repository:

- Exact direct dependency versions, committed lockfiles, and separate audits for all four dependency graphs.
- Root pnpm overrides for patched transitive versions, a seven-day minimum release age, and disabled automatic peer installation.
- Packaging installations use `npm ci --ignore-scripts`.
- GitHub Actions use immutable commit SHAs; CI and dependency review have read-only repository permissions.
- StartOS Node image uses a version and digest; yq and StartOS CLI downloads have checksum checks. Desktop Tor downloads have pinned trusted hashes.
- GitHub code security, secret scanning, and secret push protection are enabled. CodeQL default setup is configured.
- Main branch protection applies to administrators, requires current status checks and a linear history, and prohibits force pushes and deletion.

Gaps and follow-ups:

1. Automatic security-update PRs are now enabled, as verified in the follow-up above.
2. Limit routine groups to patch/minor updates and isolate major migrations. Electron needs its own visible upgrade path because support expires frequently; do not indefinitely suppress its major updates. Keep coordinated library families together.
3. Add distribution smoke checks for desktop/runtime dependency changes and Dockerfile changes. Current PR CI installs packaging dependencies and type-checks wrapper code, but only builds/tests the root application graph; it does not launch installers or containers.
4. Require fresh checks after bringing each PR onto current main. All six displayed a neutral `CodeQL` result and lacked a completed `Analyze (javascript-typescript)` check in their displayed rollups. Main protection requires `verify`, `dependency-review`, `Analyze (javascript-typescript)`, and `CodeQL`. A neutral result is not evidence that source analysis ran; investigate missing analysis if it remains absent after refresh instead of bypassing protection.
5. Main protection requires zero approving human reviews and does not require code-owner review. Consider requiring review for wallet cryptography, release workflows, and security configuration changes.
6. Spot checks found existing Electron boundary hardening work: `desktop/src/main.ts` passes popup URLs directly to `shell.openExternal`, and the preload exposes an unrestricted URL helper. Add an explicit allowed-protocol policy and restrict navigation to the application origin, following [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security). This is a pre-existing risk to address separately; the dependency PRs do not fix it, and no end-to-end exploit was demonstrated here.
7. Desktop notarization/publishing configuration remains unfinished in `electron-builder.yml`. Validate signing and release provenance before distribution.

The existing Lottie direct-eval warning remains in the production build and is documented in `SECURITY_AUDIT.md`: animation data must remain trusted repository content. The dependency upgrades reviewed here do not by themselves establish removal of that behavior.

## Validation performed

| Check                                        | Result and limits                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| All four main lockfile audits                | No moderate/high/critical findings; root retains one low                                     |
| Five proposed npm/pnpm graphs                | Root groups retain one low; #3/#4 clean; #5 has two high affected packages                   |
| Main dependency versions                     | All installed direct dependency versions matched the manifest exactly                        |
| Main formatting and lint                     | Passed                                                                                       |
| Main TypeScript check                        | Passed                                                                                       |
| Main desktop and StartOS wrapper type checks | Passed                                                                                       |
| Main unit tests                              | 454 tests across 41 files passed; two of three Turbo test tasks reused cache                 |
| Main build                                   | Passed; one of two Turbo build tasks reused cache; documented Lottie warning remains         |
| PR #3 and #4 clean package installs          | Passed with lifecycle scripts disabled in isolated temporary directories                     |
| PR #4 desktop type check                     | Passed with proposed Electron/TypeScript dependencies and current main desktop source        |
| PR #4 SQLite smoke test                      | In-memory query passed under Node 22.23.2, not Electron                                      |
| PR #3 and #4 PDF smoke tests                 | Three template variants each rendered; checked valid PDF headers and nontrivial output sizes |
| GitHub security state                        | One low Dependabot alert; no open CodeQL or secret-scanning alerts                           |

The smoke tests used repository sample statements, not user portfolio data. Their success establishes execution, not visual PDF equivalence. No live hardware wallets, exchange accounts, user databases, production StartOS device, signed desktop installer, Electron runtime session, or container OS scan was used. This was a dependency/PR security review with targeted boundary inspection, not a penetration test or exhaustive source-code audit. None of the six PRs is approved for an unconditional merge based on the recorded checks alone.

## Suggested merge sequence

1. Completed: enabled Dependabot security updates. Keep existing audit and branch-protection checks enforced.
2. Refresh and validate a supported Electron upgrade from #4. Make the macOS minimum-version decision explicit; avoid coupling it to unnecessary compiler migration work.
3. Coordinate the PDF renderer change from #3/#4 across distribution and development graphs, then validate PDF output in the packaged runtimes.
4. Split compatible production/tooling maintenance from the major migrations in #42/#41.
5. Replace #5 only when both its bundled advisories and lockfile consistency are fixed and StartOS compatibility is demonstrated.
6. Retain a supported Node LTS baseline or deliberately migrate to another LTS line with container validation; do not merge #16 just to select the highest major.

## Direct dependency change inventory

The following inventory records the proposed changes, not accepted upgrades. Routine-looking version increments still require the checks described above.

### PR #4

Manifest: `desktop/package.json`.

| Dependency            | Before    | Proposed | Change |
| --------------------- | --------- | -------- | ------ |
| `@react-pdf/renderer` | `4.3.2`   | `4.9.0`  | Minor  |
| `electron`            | `41.10.4` | `44.2.0` | Major  |
| `typescript`          | `5.9.3`   | `7.0.2`  | Major  |

### PR #3

Manifest: `start9/runtime/package.json`.

| Dependency            | Before  | Proposed | Change |
| --------------------- | ------- | -------- | ------ |
| `@react-pdf/renderer` | `4.3.2` | `4.9.0`  | Minor  |

### PR #5

Manifest: `start9/package.json`.

| Dependency              | Before    | Proposed | Change        |
| ----------------------- | --------- | -------- | ------------- |
| `@start9labs/start-sdk` | `1.5.3`   | `2.0.9`  | Major         |
| `@types/node`           | `22.20.1` | `26.4.1` | Major         |
| `@vercel/ncc`           | `0.38.4`  | `0.45.0` | Pre-1.0 minor |
| `typescript`            | `5.9.3`   | `7.0.2`  | Major         |

### PR #42

Manifest: `package.json`.

| Dependency                      | Before    | Proposed  | Change        |
| ------------------------------- | --------- | --------- | ------------- |
| `@bitcoinerlab/descriptors`     | `2.1.0`   | `3.2.0`   | Major         |
| `@bitcoinerlab/secp256k1`       | `1.1.1`   | `2.0.0`   | Major         |
| `@chakra-ui/anatomy`            | `2.2.2`   | `2.3.4`   | Minor         |
| `@chakra-ui/react`              | `2.8.2`   | `3.37.0`  | Major         |
| `@emotion/react`                | `11.11.4` | `11.14.0` | Minor         |
| `@emotion/styled`               | `11.11.5` | `11.14.1` | Minor         |
| `@fastify/static`               | `10.1.2`  | `10.1.3`  | Patch         |
| `@fontsource/roboto-mono`       | `5.1.0`   | `5.3.0`   | Minor         |
| `@hookform/resolvers`           | `3.6.0`   | `5.9.1`   | Major         |
| `@keystonehq/bc-ur-registry`    | `0.7.1`   | `0.8.0`   | Pre-1.0 minor |
| `@ledgerhq/hw-app-btc`          | `10.6.0`  | `11.4.0`  | Major         |
| `@ledgerhq/hw-transport`        | `6.31.4`  | `6.35.7`  | Minor         |
| `@ledgerhq/hw-transport-webhid` | `6.30.0`  | `6.36.0`  | Minor         |
| `@noble/hashes`                 | `2.0.1`   | `2.4.0`   | Minor         |
| `@react-pdf/renderer`           | `4.3.2`   | `4.9.0`   | Minor         |
| `@tanstack/react-query`         | `4.36.1`  | `5.102.8` | Major         |
| `@trpc/client`                  | `10.45.3` | `11.18.0` | Major         |
| `@trpc/react-query`             | `10.45.3` | `11.18.0` | Major         |
| `@trpc/server`                  | `10.45.3` | `11.18.0` | Major         |
| `bip32`                         | `4.0.0`   | `5.0.1`   | Major         |
| `bip322-js`                     | `2.0.0`   | `4.0.0`   | Major         |
| `bs58check`                     | `3.0.1`   | `4.0.0`   | Major         |
| `date-fns`                      | `4.1.0`   | `4.4.0`   | Minor         |
| `decimal.js`                    | `10.4.3`  | `10.6.0`  | Minor         |
| `ecpair`                        | `2.1.0`   | `3.0.2`   | Major         |
| `fastify`                       | `5.12.1`  | `5.12.3`  | Patch         |
| `framer-motion`                 | `13.0.0`  | `13.2.0`  | Minor         |
| `lottie-react`                  | `2.4.1`   | `3.1.1`   | Major         |
| `lucide-react`                  | `1.28.0`  | `1.41.0`  | Minor         |
| `nanoid`                        | `5.1.16`  | `6.0.1`   | Major         |
| `pino`                          | `8.17.2`  | `10.3.1`  | Major         |
| `pino-pretty`                   | `10.3.1`  | `13.1.3`  | Major         |
| `react-hook-form`               | `7.84.0`  | `7.87.0`  | Minor         |
| `react-router`                  | `8.3.0`   | `8.3.1`   | Patch         |
| `react-transition-state`        | `2.3.1`   | `2.4.0`   | Minor         |
| `socks`                         | `2.8.9`   | `2.8.10`  | Patch         |
| `sonner`                        | `2.0.7`   | `2.0.8`   | Patch         |
| `type-fest`                     | `4.15.0`  | `5.9.0`   | Major         |
| `zod`                           | `3.25.76` | `4.5.4`   | Major         |
| `zustand`                       | `5.0.3`   | `5.0.15`  | Patch         |

Manifest: `packages/package.json`.

| Dependency                   | Before    | Proposed | Change        |
| ---------------------------- | --------- | -------- | ------------- |
| `@keystonehq/bc-ur-registry` | `0.7.1`   | `0.8.0`  | Pre-1.0 minor |
| `date-fns`                   | `4.1.0`   | `4.4.0`  | Minor         |
| `decimal.js`                 | `10.4.3`  | `10.6.0` | Minor         |
| `nanoid`                     | `5.1.16`  | `6.0.1`  | Major         |
| `socks`                      | `2.8.7`   | `2.8.10` | Patch         |
| `type-fest`                  | `4.15.0`  | `5.9.0`  | Major         |
| `zod`                        | `3.25.76` | `4.5.4`  | Major         |

### PR #41

Manifest: `package.json`.

| Dependency                         | Before    | Proposed  | Change |
| ---------------------------------- | --------- | --------- | ------ |
| `@tanstack/eslint-plugin-query`    | `5.101.4` | `5.102.8` | Minor  |
| `@types/node`                      | `22.20.1` | `26.4.1`  | Major  |
| `@types/qrcode`                    | `1.5.5`   | `1.5.6`   | Patch  |
| `@types/react`                     | `18.3.31` | `19.2.18` | Major  |
| `@types/react-dom`                 | `18.3.7`  | `19.2.7`  | Major  |
| `@typescript-eslint/eslint-plugin` | `8.53.0`  | `8.69.0`  | Minor  |
| `@typescript-eslint/parser`        | `8.53.0`  | `8.69.0`  | Minor  |
| `@vitejs/plugin-react`             | `6.0.5`   | `6.1.1`   | Minor  |
| `esbuild`                          | `0.28.1`  | `0.28.2`  | Patch  |
| `eslint`                           | `9.15.0`  | `10.10.0` | Major  |
| `eslint-config-prettier`           | `9.1.0`   | `10.1.8`  | Major  |
| `eslint-plugin-import`             | `2.31.0`  | `2.32.0`  | Minor  |
| `eslint-plugin-react`              | `7.37.2`  | `7.37.5`  | Patch  |
| `eslint-plugin-react-hooks`        | `5.0.0`   | `7.1.1`   | Major  |
| `eslint-plugin-unused-imports`     | `4.1.4`   | `4.4.1`   | Minor  |
| `husky`                            | `9.0.5`   | `9.1.7`   | Minor  |
| `jsonc-eslint-parser`              | `2.4.2`   | `3.3.0`   | Major  |
| `lint-staged`                      | `15.2.0`  | `17.4.1`  | Major  |
| `prettier`                         | `3.2.5`   | `3.9.6`   | Minor  |
| `prettier-plugin-packagejson`      | `3.0.0`   | `3.0.2`   | Patch  |
| `sass`                             | `1.102.0` | `1.104.0` | Minor  |
| `tsx`                              | `4.23.8`  | `4.23.13` | Patch  |
| `turbo`                            | `2.10.8`  | `2.10.12` | Patch  |
| `typescript`                       | `5.9.3`   | `7.0.2`   | Major  |
| `vite`                             | `8.2.0`   | `8.2.2`   | Patch  |
| `vitest`                           | `4.1.10`  | `5.0.0`   | Major  |
