# Desktop app review

## Current status — September 17, 2026

`desktop-saved-connections` contains the complete `desktop-app-review` checkpoint (`f70d733`) and the desktop browser-preview command (`19d4b91`), based on `main` through `2020b55`. The desktop fixes and shared release workflows are being submitted together for draft review. The dated sections below record earlier artifacts and test runs; they do not establish acceptance of the latest installer.

The Settings page now saves up to five named Electrum connections in local SQLite. It preserves the existing configuration as **Current connection**, supports renaming, deletion, and explicit connection changes, and retains the active profile across restarts. The list appears beside the form on wide windows and becomes a dropdown above it when space is limited. Trash icons in both layouts require confirmation; users must connect to another profile before deleting the active one. Deletion preserves account data and unrelated form edits. Public-server starting points appear only when creating a connection. Saving or testing a new profile does not activate it; failed or interrupted activation retains the previous connection. Desktop launchers explicitly enable this capability, including `corepack pnpm dev:desktop`; StartOS continues using its managed configuration.

Focused automated coverage includes migration, persistence, the five-profile limit, endpoint validation, failed saves, simultaneous/interrupted switches, Tor routing, and maintaining a single provider for portfolio and statement consumers. Deletion tests cover active/last-profile protection, stale revisions, storage failures, concurrent deletion, an in-progress switch to a deleted profile, and preservation of unrelated drafts. Browser checks using an isolated local Electrum fixture cover both layouts, draft preservation at 800/600/390-pixel widths, rename, save without activation, explicit activation, confirmed deletion, and reload persistence. The packaged-runtime check also verifies that the saved-connections API is enabled and migrates the fixture connection.

### Issue scope for the draft PR

- **#40 — Sentinel port conflict:** implemented. Desktop binds an OS-assigned loopback port and uses its own data directory. Automated tests cover both startup orders and independent shutdown, alongside the packaged dynamic-port smoke check. This is the completed issue targeted for closure on merge.
- **#39 — Saved connections:** implemented under the agreed five-profile design, including confirmed deletion and active-profile protection. Keep open: the issue's controlled-account LAN/Tor comparison and full packaged restart/route acceptance checks still need recorded results. Do not infer these from fixture tests.
- **#29 — Mac desktop parity:** keep open for the remaining installed-app acceptance checklist, including physical multisig signing on the final artifact, sleep/wake, upgrades, and backup/restore. Earlier user tests reported working Trezor, Ledger, and statements.
- **#67 — Automatic public fallback** and **#44 — Setup transfer:** separate follow-ups, not implemented here. Offline startup remains usable without selecting another server automatically.

### Release validation still required

The PR includes native Mac ARM64 and Windows x64 installer jobs, candidate builds for StartOS and both desktop platforms, and assembly of all three packages into one draft release with matching source/version identities and checksums. Draft [PR #92](https://github.com/hoseki-inc/bitcoin-control-center/pull/92) is open. Native Mac and Windows installer jobs, repository verification, and both platform runtime checks passed at `a31067e`, including profile deletion. The dated results below do not replace the latest PR checks or installed-app acceptance.

CodeQL reported four cache-poisoning findings in the reusable desktop workflow and its setup action. The workflow now builds only the caller's exact event commit, without a separate source-ref input, and verifies the checkout before executing repository code. Candidate and draft-release jobs use that same commit; the draft release retains its default-branch gate and artifact identity checks. Installer builds and both release workflows use `cache-mode: none`, preventing shared cache reads and writes even in called workflows. Ordinary CI verification retains its existing cache policy. Actionlint 1.7.12 predates this GitHub setting, so local linting excludes only its unknown `cache-mode` diagnostic; GitHub's workflow validation and CodeQL checks remain required.

The first native GitHub jobs failed in dependency installation: pnpm attempted an unnecessary implicit `node-gyp` build of `better-sqlite3` 13. Mac hit a permissions error in pnpm's bundled gyp launcher, while Windows could not discover a compatible Visual Studio installation. The workspace now explicitly skips SQLite's install build because this pinned version ships Node-API prebuilds, matching the existing desktop packaging policy. The shared CI setup verifies that its host SQLite binary opens successfully. A fresh isolated installation and SQLite write/read passed locally without compilation, as did the extended saved-connections smoke check against the local Mac artifact.

The next Mac job created the installer but failed signature verification because electron-builder skips signing on pull requests, including the configured ad-hoc identity. The Mac build command now enables PR signing only for its explicit certificate-free ad-hoc invocation and verifies the bundle before staging the artifact. A local build with PR detection enabled passed signature verification and the packaged saved-connections/Tor smoke test. It does not introduce Developer ID credentials or notarization. The native GitHub rerun passed at `128b97e`.

Mac notarization, Windows publisher signing, automatic updates, and hands-on Windows installation/wallet/upgrade testing remain outside this draft's completed work. A passing packaged-backend smoke check does not establish interactive installer readiness.

## Checkpoint — September 10, 2026

`desktop-app-review` includes `main` through `2020b55` (StartOS `0.2.4:0`) in merge commit `1bb219f`. This brings in the separately shipped Ledger multisig repair, the newer inline Ledger connection flow, Electron `44.2.0`, PDF renderer `4.9.0`, and the intervening security and dependency updates. This checkpoint includes the restored port-isolation and release-workflow changes plus the desktop system-certificate trust fix. The original stash remains available as a backup.

The merge preserves the desktop connection recovery, Tor lifecycle, Trezor popup, and shutdown fixes. The main window now has the narrow Ledger preload required by the newer flow. Ledger owns HID selection while the existing wallet integration retains its device permissions and Trezor USB chooser, with a regression test guarding against duplicate HID handlers.

### Public Electrum certificate trust follow-up

While testing away from the LAN, the user enabled their StartOS Electrs public SSL interface and encountered `self signed certificate in certificate chain`. A diagnostic in the packaged Electron runtime reproduced the failure: the node's Root CA was already trusted by macOS but absent from the backend's default authority list. The server's certificate matched its public IP and was valid. Including the existing system authorities passed a fully verified TLS handshake in approximately 160 ms.

The desktop launcher now supplements Node's existing certificate authorities with the operating system's trusted authorities before initializing Sentinel. It does not install authorities, trust certificates fetched from a server, or disable public certificate verification. This is desktop-specific startup configuration; shared Electrum behavior and StartOS configuration are unchanged. A per-connection certificate import UI and saved named profiles remain future work.

The user confirmed that the rebuilt Mac app now connects successfully through the public interface.

The desktop suite passes 18 tests, including real TLS handshakes covering the trusted-CA case and rejection of untrusted and wrong-address certificates. Desktop type checks and all 28 Ledger-handler tests pass. The Electron 44 runtime check also exercises system trust initialization, SQLite, and PDF rendering. The rebuilt Mac application's own `Test Connection` API successfully negotiated the user's public Electrs connection directly over verified TLS in 334 ms, using an isolated empty profile without saving settings or querying wallet data. These connection timings do not measure portfolio synchronization.

Both installers were rebuilt with this fix, and the Mac package signature and isolated backend smoke test pass. The first combined wallet-window harness reached its cleanup deadline while packaging was running; a separate connection-and-quit check and a repeat of the combined check both passed. The repeat covered the public connection, inline Ledger request/cancel, Trezor popup/USB cancel, navigation policy, and graceful shutdown in approximately four seconds. Physical multisig signing remains the user's next acceptance test. Native Windows trust-store validation remains pending the GitHub runtime job.

### Merge and release validation

The full repository CI command passes: 565 shared/API/UI/desktop/release-assembly tests, 28 native Ledger-handler tests, and 8 StartOS tests. Formatting, lint, all type checks, builds, and the configured dependency-audit threshold pass; the audit reports one low-severity root advisory and none in the desktop or StartOS npm packages. The release workflows also pass actionlint.

Both refreshed installers built successfully with desktop version `0.2.4` and full release identity `0.2.4:0`:

- Mac ARM64: `desktop/release/artifacts/mac/Bitcoin-Control-Center-v0.2.4_0-mac-arm64.dmg`
- Windows x64: `desktop/release/artifacts/win/Bitcoin-Control-Center-v0.2.4_0-win-x64.exe`

Their metadata records the merge commit plus uncommitted changes. The actual Mac executable passes signature verification and the packaged backend/SQLite/frontend/local-Electrum/dynamic-port/Tor smoke test. Its packaged PDF renderer also produces a complete synthetic PDF. A separate Electron `44.2.0` launcher using the packaged application and an isolated empty profile verified Settings, the sandboxed Ledger bridge, exactly one HID-selection handler, inline Ledger request/cancellation, and blocked off-origin navigation. A synthetic page at the approved Trezor origin verified that the popup has an opener but no application bridge or Node access, and that its USB chooser opens and cancels. These checks do not connect to physical wallets. Windows was cross-built on macOS and has not been run locally.

The recommended next work is:

1. **Save named connection profiles.** [Issue #39](https://github.com/hoseki-inc/bitcoin-control-center/issues/39) tracks this intentional desktop-only feature. Start with saving, editing, deleting, and explicitly switching between named LAN, public SSL, and Tor connections; remember the active profile across restarts and preserve it when a replacement connection fails. This feature is not part of the current checkpoint.
2. **Complete desktop acceptance testing.** Recheck physical Ledger multisig signing on the refreshed Mac build, run desktop alongside local development in both startup orders, and confirm accounts and connection settings survive a restart. The user has reported working Trezor and Ledger connections and statements on earlier builds. A Windows tester is still needed for installation, windows/tray, hardware wallets, and upgrades.
3. **Finish release delivery.** Run the restored native packaging workflow on GitHub. The goal remains one release containing StartOS, Mac ARM64, and Windows x64 artifacts from the same commit. Main's [native runtime check](https://github.com/hoseki-inc/bitcoin-control-center/actions/runs/34409346254) already passed SQLite and PDF checks on Mac and Windows; the broader installer workflow has not yet run on GitHub. [Setup transfer #44](https://github.com/hoseki-inc/bitcoin-control-center/issues/44) and [connection fallback #67](https://github.com/hoseki-inc/bitcoin-control-center/issues/67) remain separate follow-ups.

Mac signing/notarization, Windows publisher signing, and an update/recovery policy remain release-readiness work. The sections below retain the original review and dated validation history; their original findings and version numbers describe those earlier builds.

## Initial review — September 6, 2026

Reviewed `c2c3a89` on `desktop-app-review`. This is a review of the current repository and newly built desktop artifacts, compared with the checked-in StartOS package (`0.2.3:1`). It does not establish which version is currently installed on a particular user's computer or Start9 server.

**The desktop app builds and opens on Apple Silicon, and its core product code remains aligned with StartOS. The follow-up repairs below address the confirmed connection, wallet-shell, and Tor defects; physical-device validation and desktop release work remain.** The recent portfolio/history changes are already shared with desktop; there is no separate old desktop implementation to catch up feature by feature.

No product code was changed during the initial review. Test profiles and diagnostic fixtures were isolated under `/tmp/bcc-desktop-review`; no existing portfolio data was used. The generated installers are local review builds, not published releases.

## Follow-up implementation on this branch

The original findings below describe the reviewed commit. A first repair addresses findings **1, 2, and 5**:

- Desktop can initialize its local API and UI while Electrum connects in the background. StartOS retains its existing requirement to connect before startup completes.
- Desktop queries continue reaching its local Sentinel instance when the computer reports no internet connection. Settings explain the disconnected state and allow retry without changing the server fields.
- Every existing portfolio and statement provider switches to the successfully tested replacement client.
- The replacement connection and all four settings are handled as one operation. Failed connections or SQLite transactions retain the previous client and settings; individual connection-setting writes are rejected.
- Competing saves are rejected while a change is pending, abandoned clients are disconnected, and interrupted requests settle instead of hanging.

The next repair (September 7) also addresses findings **3, 4, 6, 7, and 9**:

- Ledger has a local, sandboxed chooser with explicit selection, cancellation, device arrival/removal, and cleanup when the requesting page closes or navigates. Only Ledger HID devices requested by the application frame are offered.
- The existing Trezor Connect SDK keeps its approved `/9/popup.html` window inside Electron, with its opener intact and without Node access or an application preload. Its USB chooser is restricted to that registered popup and the SDK's Trezor device filters. Ordinary web/email links still open externally; other protocols and off-origin main-window navigation are blocked.
- Electron 41 issues some device permission checks with a null window and `isMainFrame=false`. Native testing caught this difference from the initial mocks. Permission checks now recognize the approved origin, and the actual selection event separately verifies the requesting frame. Regression coverage includes these real event shapes.
- Canceling Trezor's initial device request no longer starts a second account-information request. Trezor SDK debug logging is disabled.
- Tor starts on demand using an available loopback port owned by this app, instead of assuming port 9050. Connections wait for bootstrap, including reconnects; startup timeout, missing binaries, spawn errors, and unexpected exit produce explicit failure states. A saved Tor configuration cannot fall back to a direct connection if the proxy is missing.
- Settings display Tor readiness/errors, and the Tor toggle explains that only Electrum traffic uses it. The backend selects the configured proxy port; the frontend no longer hard-codes 9050.
- The Mac expert-bundle Tor executable and library were unsigned and were being killed before startup. Development builds and the packaging hook now apply and verify local ad-hoc signatures. The final signing configuration also lists these binaries for future Developer ID builds. This is not notarization or release signing.
- Quit prevents Electron from exiting until Tor stops and the local server shuts down. Startup errors show a dialog, failed HTTP binding releases database resources, and a second instance no longer enters the startup path.
- The tray asset is copied into the application and restored/minimized windows can be shown again. The app uses a standard draggable native title bar. The unused, broken main-window preload bridge was removed entirely.

**Validation:** 484 tests pass (321 shared, 83 API, 66 UI, 14 desktop), with the desktop tests now included in the normal test command and CI. Root and desktop type checks, lint, and the frontend/backend/shell builds pass. The packaged Mac app has also been exercised using Electron 41.10.4 and an isolated profile:

- Ledger chooser opened through the actual browser HID API and canceled with an empty selection; its temporary listeners were removed.
- The real Trezor SDK reached its “Connect Trezor to continue” screen in an in-app popup with an intact opener, sandbox enabled, no Node access, and no application bridge. Trezor USB selection opened and canceled; canceling the SDK popup did not open another one.
- Main-window navigation away from the local app was blocked, and the packaged tray asset was present.
- Bundled Tor bootstrapped and successfully negotiated a public Electrum connection through the app's chosen SOCKS port. The unrelated process already listening on 9050 was left untouched.
- The app's Tor child had exited before Electron's `will-quit` event, both after a successful connection and when quitting during bootstrap. A failed Tor launch also returned an actionable Settings error without closing the app.

The earlier packaged recovery check also passed: a previously failing profile opened Settings, successfully changed to a local test server, and retained that setting after reload. Physical wallet account import/signing, a real onion Electrum server, Windows execution, release signing/notarization, updates, and backup/restore remain acceptance work. The Mac ARM64 DMG and Windows x64 installer were both rebuilt with all repairs. Windows was cross-built only; native execution remains unverified. These repairs form the desktop review checkpoint; no release has been published.

### User testing feedback

The user reports that Trezor and Ledger connections and statements work. Physical Ledger multisig signing on the refreshed build still needs confirmation after the separately shipped repair. Local Electrs connection tests passed, and the user is comparing whole-app speed over LAN. The selected connection approach is LAN at home and Tor away, without a paid VPN service. Saved desktop connection profiles are tracked in issue #39; they are intentionally specific to desktop.

### Port isolation and release workflow follow-up (September 7)

The desktop server now binds an operating-system-assigned loopback port instead of development's fixed `3400`. The actual bound port is returned to the Electron shell and used for its UI, navigation policy, and wallet permissions. Automated tests cover both startup orders, independent shutdown, and cleanup after a configured-port collision. This addresses issue #40 without changing the development or StartOS default port. The desktop launcher also converts its backend path to a file URL so Windows drive letters are valid dynamic-import targets.

The numbered release workflows now build all three artifacts from one commit: universal StartOS `.s9pk`, Apple Silicon Mac `.dmg`, and Windows x64 `.exe`. A reusable native desktop matrix also runs in normal PR/main CI. Desktop build reports record the full protected release version, semantic desktop version, source commit, dirty-source status, and SHA-256 checksum. Draft assembly requires both desktop jobs to pass and rejects mismatched revisions, commits, filenames, dirty sources, missing installers, and altered checksums. It keeps StartOS's existing version preparation, signing-key handling, release-note validation, and draft-only publication behavior.

Both local installer builds completed with the shared version `0.2.3:1` / desktop version `0.2.3`. The first exact Mac executable check caught a Team ID library-validation failure from combining ad-hoc signing with hardened runtime. Review builds now disable hardened runtime; Developer ID signing and notarization remain future release work. The corrected Mac signature and packaged-runtime smoke test pass, including SQLite, frontend assets, a local Electrum fixture, dynamic port binding, and execution of bundled Tor. Windows was cross-built on macOS; the new native Windows job has not yet run.

**Validation:** the full repository CI command passed with 492 tests (321 shared, 86 API, 66 UI, 14 desktop, 5 release-assembly tests), root/desktop/StartOS type checks, formatting, lint, builds, and the configured dependency-audit threshold. The audit reports one low-severity root advisory and none in desktop or the StartOS npm packages. Workflow syntax passed actionlint. These are local results; no GitHub workflow run, release, or new commit is claimed.

**Acceptance work:** install the rebuilt Mac DMG and run it alongside `pnpm dev` in both startup orders, then confirm saved connections and account data survive restart and repeat a hardware-wallet connection/signing flow. Browser-only appearance preferences are scoped to the changing HTTP origin and may reset; portfolio data and connection settings stay in the existing SQLite data folder. Native Windows installation, physical-wallet signing, upgrade/data preservation, publisher signing, automatic updates, and backup/restore remain unverified.

The current local artifacts are `desktop/release/artifacts/mac/Bitcoin-Control-Center-v0.2.3_1-mac-arm64.dmg` and `desktop/release/artifacts/win/Bitcoin-Control-Center-v0.2.3_1-win-x64.exe`, with metadata and checksums beside them. Their manifests explicitly record the uncommitted source changes.

## What was verified

| Check                                                                          | Result                                                   | Limits                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root TypeScript check and desktop TypeScript check                             | Passed                                                   | Desktop shell is checked separately from the workspace.                                                                                                                                            |
| Fresh automated tests, bypassing task cache                                    | 445 passed across 40 files                               | 318 shared, 65 Sentinel, 62 frontend. No desktop-specific automated suite exists.                                                                                                                  |
| Sentinel production build                                                      | Passed                                                   | Used the repository-compatible Node runtime.                                                                                                                                                       |
| Desktop-mode frontend build                                                    | Passed                                                   | Confirmed Vite used `production.desktop`; desktop settings appeared at runtime. Existing bundle-size, Lottie eval, and import warnings remain.                                                     |
| Electron shell build                                                           | Passed                                                   | Fresh packaging input was generated.                                                                                                                                                               |
| Pinned Tor downloads                                                           | Passed                                                   | Both official archives downloaded and matched the checked-in SHA-256 values.                                                                                                                       |
| macOS ARM64 DMG                                                                | Built, approximately 146 MB                              | Review build has an ad-hoc signature, no Developer ID identity, and no notarization verification.                                                                                                  |
| Windows x64 NSIS installer                                                     | Built, approximately 121 MB                              | Cross-built on macOS; no Authenticode certificate in the generated installer. Not installed or executed on Windows.                                                                                |
| macOS packaged application code                                                | Opened and rendered successfully                         | Loaded the actual packaged ASAR with Electron 41.10.4 through a test launcher that isolated userData and selected the package resources. This is not a clean-machine installation/Gatekeeper test. |
| Home, Accounts, Add Account, Portfolio, Settings, Statements, Create Statement | Rendered                                                 | Used an empty profile and a synthetic manually entered holding.                                                                                                                                    |
| Manual holding                                                                 | Created through the packaged API and displayed correctly | A synthetic 1,000,000-satoshi balance appeared as 0.01000000 BTC in Accounts and Portfolio.                                                                                                        |
| Desktop Electrum settings                                                      | Rendered and reported a live SSL connection              | Full settings save behavior has defects described below.                                                                                                                                           |
| Blob/file download                                                             | Completed successfully                                   | Exercised the download mechanism with a test file, not a complete generated statement PDF.                                                                                                         |
| Close-to-tray behavior                                                         | Window hid without being destroyed                       | Tray image itself is absent.                                                                                                                                                                       |
| Desktop npm dependency audit                                                   | Zero reported vulnerabilities                            | Snapshot of the npm advisory database at review time; not a full application security assessment.                                                                                                  |

The documented `./desktop/build.sh` stopped on this machine because its bare `pnpm` command selected 9.12.2 instead of the pinned 10.17.0. The StartOS build already uses `corepack pnpm`. A separate host execution environment also selected Node 22.9.0, which caused the packager's CommonJS/ESM dependency load to fail. Selecting Node 22.23.2 explicitly and using Corepack resolved those environment problems; the individual application and packaging stages then passed. The full script was not represented as having passed unchanged.

## Findings that should lead the work

### 1. P1 — A failed Electrum connection prevents the entire desktop UI from opening

**Confirmed in a runtime test.** A temporary profile configured with an unreachable Electrum endpoint produced an unhandled connection error and still had zero windows after the 20-second observation period.

[Desktop startup](../desktop/src/main.ts#L46) awaits `main()` before creating the browser window. [Context initialization](../apps/api-sentinel/src/context.ts#L77) returns an error if its initial Electrum connection fails. There is no loading window, connection-recovery screen, or catch handler that gives the user a way to repair the configuration. A service port conflict on the fixed HTTP port 3400 reaches the same unhandled startup path; that condition was identified in code rather than separately reproduced.

A public server outage, unavailable private server, offline laptop, or bad saved setting therefore makes the app appear broken and hides the settings needed to recover. StartOS also requires a working Electrum connection, but its service manager provides a separate health/restart surface; desktop does not.

**Recommended correction:** Start the UI and local data services independently of Electrum availability. Show connection state, preserve access to cached holdings and settings, and offer retry/change-server actions. Handle database, bind-port, and other startup failures visibly as well.

### 2. P1 — Switching servers does not switch portfolio and statement queries

**Confirmed with two local Electrum fixtures and the current application context.** After a successful A-to-B reconnect:

- `electrumStatus`/the context's active client pointed to server B.
- The portfolio service still held the original provider and queried server A.
- The statement service also still held the original provider and queried server A.

[The reconnect function](../apps/api-sentinel/src/context.ts#L137) replaces `ctx.electrumClient` and `ctx.onchainProvider`. The already-created [portfolio service](../apps/api-sentinel/src/modules/control_center/service.ts#L70) and [statement service](../apps/api-sentinel/src/modules/statements/service.ts#L101) retain their constructor-injected provider. The old client can reconnect automatically, so this is more than a stale status indicator: subsequent requests can continue reaching the previously selected server.

This also undermines changing from a public connection to a private or Tor connection. No real account identifiers were sent in the reproduction.

**Recommended correction:** Make every consumer use one replaceable connection/provider owner, or explicitly replace all dependent services. Verify successful switching, failed switching, in-flight work, shutdown, and switching to/from Tor. A failed replacement should preserve the last working connection.

### 3. P1 — Ledger's browser connection flow lacks its Electron device-selection integration

**Confirmed missing integration; physical-device operation remains untested.** The shared [Ledger flow](../packages/ui/wallet-ui/ledger/device-store.tsx#L130) calls `TransportWebHID.create()`. The desktop shell installs neither a `select-hid-device` handler nor an alternative device-permission grant mechanism. The running window's session had zero HID-selection handlers.

Electron requires the application to implement device selection/permission behavior that a normal browser supplies through its chooser. See [Electron's device-access documentation](https://www.electronjs.org/docs/latest/tutorial/devices#webhid-api).

The Ledger account and signing screens are present, but the desktop integration needed to select a device is missing. StartOS running in a supported browser has the browser's chooser available.

**Recommended correction:** Add a user-visible device chooser with a narrowly scoped origin/device permission policy, handle cancellation and unplugging, and verify public-key retrieval and message signing with a real Ledger.

### 4. P1 — The desktop popup policy conflicts with Trezor Connect

**Confirmed popup behavior, with the end-to-end wallet impact inferred from the integration.** The [Trezor service](../packages/ui/wallet-ui/trezor/trezor-service.ts#L21) uses `coreMode: 'popup'`. The [desktop new-window handler](../desktop/src/main.ts#L66) forwards every popup URL to the system browser and denies its Electron window.

A runtime probe of a Trezor popup URL returned a null popup window and invoked the external-browser handler. The test intercepted the external launch rather than opening another browser. This breaks the normal in-app opener/popup relationship the shared flow expects; a physical Trezor handshake was not performed.

**Recommended correction:** Implement the supported Trezor desktop integration or a carefully restricted popup arrangement, while keeping ordinary external links in the system browser. Test connect, cancellation, public-key retrieval, and signing on both operating systems.

### 5. P2 — Connection settings are saved before validation succeeds, with no atomic outcome

**Confirmed in code.** [Save & Reconnect](../apps/control-center/src/pages/settings/index.tsx#L202) fires four independent setting mutations without awaiting them, then attempts to reconnect. [The setting hook](../apps/control-center/src/hooks/use-local-settings.ts#L13) exposes a fire-and-forget `save`, so persistence failures do not reach the surrounding try/catch.

A failed reconnect can leave the failed server configuration saved for the next launch. Separate writes can also leave a partial configuration or report success before persistence has completed. Combined with finding 1, saving a bad endpoint can prevent the next launch from offering any way to repair it.

**Recommended correction:** Use one backend operation to validate/test the complete configuration, switch the runtime connection, and persist it transactionally. Surface errors and preserve a known-good configuration. Add coverage for failed persistence as well as failed connection attempts.

### 6. P2 — Tor readiness, failure reporting, and process cleanup are incomplete

**Confirmed in code, with partial runtime evidence.** [TorManager](../desktop/src/tor.ts#L22) resolves startup after 30 seconds even if bootstrap never completes, does not handle spawn errors or process exit, and does not consume/report stderr. [Desktop startup](../desktop/src/main.ts#L23) starts it in the background but immediately advertises its fixed SOCKS port, so a saved Tor connection can attempt to connect before Tor is usable and hit finding 1.

The fixed port 9050 was already occupied by a separate Tor process on this review machine. That pre-existing process was left untouched. The manager does not distinguish its own successful startup from a port collision or another proxy listening there. Successful isolated bundled-Tor bootstrap and onion connectivity were therefore not established by this review.

[Quit cleanup](../desktop/src/main.ts#L103) awaits server shutdown inside an async event listener without preventing application exit. Electron does not treat the returned promise as an exit barrier. In the quit probe, `will-quit` fired before the application's Tor stop request had been issued. The test launcher separately cleaned up its own child processes. See [Electron's application events](https://www.electronjs.org/docs/latest/api/app#event-before-quit).

**Recommended correction:** Track bootstrap and child-process state explicitly, report failures in Settings, handle port ownership/collisions, and await a controlled shutdown before quitting. Route only the intended traffic through the selected proxy and explain that scope: the current Tor setting applies to Electrum, not all exchange or market-data HTTP traffic.

### 7. P2 — The tray icon is absent from the source assets and installer

**Confirmed by source and packaged-ASAR inspection.** [Tray creation](../desktop/src/tray.ts#L5) references `resources/tray-icon.png`. Only `desktop/resources/icon.png` exists, and the installer contains no `tray-icon` asset. The build resources configuration also does not copy that expected path into the application's runtime files.

On this Mac, creating the tray with an empty image did not prevent launch, and closing the window hid it as intended. The absent visible icon still compromises discovery and restoration, especially on Windows where there is no macOS Dock fallback. Windows tray behavior needs a native test.

**Recommended correction:** Ship an actual tray asset at a verified runtime path, including a macOS template icon where appropriate, and test show/hide, minimize/restore, second launch, and Quit.

### 8. P2 — The universal Mac command is incompatible with the bundled Tor architecture

**Confirmed by file inspection.** [The package script](../desktop/package.json#L13) advertises `--universal`, but [the downloader](../desktop/download-tor.sh#L4) only fetches macOS ARM64 Tor. The downloaded executable is ARM64-only. The main build script's default Mac build produced an ARM64 app on this host.

A universal Electron wrapper cannot make the ARM64 Tor executable run on an Intel Mac. Intel Mac support is therefore not established, even if a universal packaging command completes.

**Recommended correction:** Explicitly support Apple Silicon only for the next candidate, or add an Intel/universal Tor distribution strategy and native Intel verification. Keep the build commands and documented platform support consistent.

### 9. P3 — The preload external-link helper cannot work in the default sandbox

**Confirmed in Electron.** Calling the exposed `window.desktop.openExternal` helper threw an error because `shell` was undefined. [The preload](../desktop/src/preload.ts#L1) imports `shell` directly, while the window uses Electron's default sandboxed preload environment. Electron documents that [shell is unavailable in a sandboxed renderer](https://www.electronjs.org/docs/latest/api/shell).

No current frontend caller of this helper was found, so this is a latent bridge defect rather than the cause of the normal external-link behavior, which is handled in the main process.

**Recommended correction:** Remove the unused helper or replace it with a narrow validated IPC request to the main process. Do not disable the sandbox to make it work.

## Parity with StartOS

| Area                                                                   | Current relationship                                                                     | Desktop assessment                                                                                                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core architecture                                                      | Same React frontend, Sentinel API, SQLite schema and migrations                          | Aligned in source. No Hoseki Services compatibility layer was introduced.                                                                                                       |
| Portfolio/history/custom date ranges                                   | Same implementation, including current reliability fixes                                 | Recent functionality is present in desktop; the portfolio screen rendered with a synthetic balance. Real on-chain history was not exercised.                                    |
| Self-custody descriptors, multisig, exchanges, manual and ETF holdings | Same API and UI implementations                                                          | Feature code is shared. Manual holding was exercised; other end-to-end integrations require the checks below.                                                                   |
| Statements and proofs                                                  | Same generation/signing code                                                             | Screens and download transport work; actual proof signing and a complete statement PDF remain unverified in Electron.                                                           |
| Hardware wallets                                                       | Shared browser-oriented workflows                                                        | Desktop needs the Ledger and Trezor integration fixes above. File/QR alternatives still need physical-device testing.                                                           |
| Electrum configuration                                                 | StartOS uses its required Electrs service; desktop exposes public/custom servers and Tor | Intentional difference, but desktop switching/recovery is currently defective.                                                                                                  |
| Network                                                                | Both launchers configure mainnet                                                         | No desktop testnet selection is currently provided.                                                                                                                             |
| Local data                                                             | Both persist Sentinel state locally                                                      | StartOS stores the `main` volume; desktop derives a data folder from Electron userData.                                                                                         |
| Backup and restore                                                     | StartOS has SDK-managed whole-volume backups                                             | No equivalent desktop backup/restore UI or recovery workflow exists. The generic README backup instructions describe the development data path, not the installed desktop path. |
| Service visibility                                                     | StartOS supplies health/restart controls and service configuration                       | Desktop lacks a startup recovery view, Tor status, and a straightforward diagnostic/log access surface.                                                                         |
| Updates and releases                                                   | StartOS has version preparation, candidates, and draft-release workflows                 | Desktop has local packaging commands, version 0.1.0, and an unused updater dependency. No desktop release/candidate workflow or implemented update checks were found.           |
| CI                                                                     | Shared code is checked, tested, and built                                                | Desktop TypeScript is checked, but the Electron shell, installers, and native launch are not built or smoke-tested in CI.                                                       |

Version 0.1.0 on desktop does not itself mean the application features are old: the build copies the current shared application. It does mean there is no comparable desktop release/version discipline or easy mapping from the displayed desktop version to the latest StartOS-tested product changes.

## Release and product work beyond the defects

1. **Create a desktop candidate pipeline.** Build on macOS and Windows, retain test installers and checksums, record the source commit, and smoke-test the packaged application. [Current CI](../.github/workflows/ci.yml#L17) stops at a desktop type check plus the shared workspace tests/build. It can remain green while Electron-specific behavior fails.
2. **Make signing and upgrade behavior concrete.** macOS notarization and publishing are placeholders in [the builder configuration](../desktop/electron-builder.yml#L24); no updater invocation exists despite the dependency. Decide the update policy, configure Developer ID/notarization and Windows signing, and test replacement of an older installed version. Separate desktop and StartOS package versions are reasonable if source/build identity is visible.
3. **Add desktop data recovery.** Provide a way to locate the data folder and back up/restore the database together with its encryption key. Test migrations and restore on disposable profiles with synthetic encrypted credentials. Keep the application ID and data-location behavior stable across upgrades.
4. **Finish the native shell.** Repair the tray, establish a draggable title area for the hidden macOS title bar, review Windows title-bar behavior, handle port conflicts, and validate normal quit, sleep/wake, second instance, minimize/restore, and disconnected startup. No custom draggable region was found in the current frontend.
5. **Review navigation and permissions.** Add explicit allowed destinations for OS external opens and prevent unintended main-window navigation away from the local app. Review device/camera permissions with actual hardware. These are hardening items, not claims that a specific exploit was demonstrated.
6. **Align the product presentation.** The running app still prominently shows the Hoseki logo and a “Standard for Bitcoin Verification” home banner. That is shared with StartOS and is not desktop drift, but it does not yet express the newly documented Bitcoin savings mission. Revise shared onboarding and copy while keeping currently available capabilities clear. Desktop onboarding should also help the user choose a server and understand the default public connection.

## Suggested order for the next work

1. **Connection reliability:** Open the UI independently of Electrum; repair provider replacement; make settings changes atomic; add retry/error states and focused regression tests.
2. **Native wallet and process integration:** Implement Ledger device selection and supported Trezor behavior; make Tor lifecycle reliable; repair tray and controlled shutdown.
3. **Desktop release readiness:** Decide supported architectures, standardize the build entry point, add native CI/candidates, implement signing/version identity and the chosen update behavior.
4. **Recovery and finishing work:** Backups/restores and upgrade tests, diagnostics, sleep/wake and window behavior, and shared savings-oriented copy.

This keeps the next effort centered on the desktop integration and delivery gaps. Most recent StartOS product work is already inherited through the shared code.

## Remaining acceptance tests

The review is sufficient to identify the current architecture, build status, reproduced failures, and priority work. It is not a release certification. Before a desktop release, complete:

- Native Windows clean install, startup, native SQLite loading, tray/quit, download/save dialogs, upgrade, and uninstall behavior.
- Apple Silicon installation through the DMG and Gatekeeper/notarization checks; Intel testing only if Intel is a supported target.
- Ledger and Trezor public-key retrieval and signing after the integration fixes; Coldcard and Keystone file/QR workflows, including camera permission and cancellation.
- A real public test wallet or controlled watch-only fixture through sync, transaction history, custom date ranges, proof creation, statement generation, PDF download, and font rendering.
- Each exchange connector with authorized test credentials, plus statement import; ETF and manual-account editing and persistence across restarts.
- A real onion Electrum endpoint, forced SOCKS port collision, Tor enable/disable with real portfolio sync, and confirmation that old server connections stop receiving requests. Cold bootstrap and a public Electrum connection through bundled Tor passed the Mac smoke test.
- Offline launch, failed configuration save, unavailable/corrupt database, HTTP port conflict, sleep/wake, and interrupted shutdown.
- Upgrade and whole-profile backup/restore with synthetic account history and encrypted exchange credentials.

Local review artifacts are under `desktop/release/`: `Bitcoin Control Center-0.1.0-arm64.dmg` and `Bitcoin Control Center Setup 0.1.0.exe`. They are unsigned/ad-hoc review builds. No release was published.
