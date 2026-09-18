# Build and release model

Bitcoin Control Center keeps the StartOS version graph in `start9/startos/versions/`. That checked-in graph is the only source of truth for the package version. Builds and Git tags must follow it; a workflow must never invent or silently increment a version.

The same release workflow also builds desktop installers. Desktop's native application version uses `major.minor.patch`; its filename and embedded build metadata retain the full `major.minor.patch:revision`, tag, and source commit. For example, release `0.2.3:1` contains desktop version `0.2.3` with `v0.2.3_1` in its filenames. The build overrides `desktop/package.json`'s placeholder version without rewriting it. Platform-specific features, such as desktop connection profiles, can share a product version with StartOS.

## Version and tag formats

The manifest uses StartOS's four-part version format:

```text
major.minor.patch:revision
```

The matching Git release tag replaces the colon with an underscore and adds `v`:

```text
manifest version 0.2.1:0 -> Git tag v0.2.1_0
```

Do not add the package name to the tag. `hoseki-sentinel-v0.2.1_0` is not the StartOS release tag.

Use the components consistently:

| Change     | Example                | Meaning                                                |
| ---------- | ---------------------- | ------------------------------------------------------ |
| `patch`    | `0.2.1:0` -> `0.2.2:0` | Incremental feature, fix, or maintenance release       |
| `minor`    | `0.2.1:0` -> `0.3.0:0` | Substantial feature release                            |
| `major`    | `0.2.1:0` -> `1.0.0:0` | Breaking or major product release                      |
| `revision` | `0.2.1:0` -> `0.2.1:1` | Packaging-only rebuild of the same application version |

## Protected version commands

Run these commands from the repository root:

```bash
# Validate every version file, import, ordering rule, and duplicate guard.
node start9/scripts/version.mjs check

# Print the current manifest version.
node start9/scripts/version.mjs get

# Print the only valid Git release tag for the current version.
node start9/scripts/version.mjs tag

# Validate the tag derived from the current graph.
RELEASE_TAG="$(node start9/scripts/version.mjs tag)"
node start9/scripts/version.mjs assert-tag "$RELEASE_TAG"
```

`npm --prefix start9 run check`, ordinary pull-request CI, and `./start9/build.sh` all validate the graph. A malformed, duplicated, missing, or out-of-order version cannot pass those gates.

## Build types

### Which workflow should I run?

The workflows are numbered in the GitHub Actions sidebar because they have different jobs:

| Goal                           | Workflow                             | Version choice?                               | Result                                    |
| ------------------------------ | ------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| Choose the next version        | **Release 1 - Prepare version**      | Yes: `patch`, `minor`, `major`, or `revision` | Opens a version pull request              |
| Test what is already committed | **Release 2 - Build candidates**     | No                                            | Produces all three test installers        |
| Create a downloadable release  | **Release 3 - Create draft release** | No                                            | Creates a draft with all three installers |

Running a candidate never changes the version. If the candidate reveals a fix that warrants a new version, merge the fix and then use **Release 1 - Prepare version** to choose the appropriate bump. After that version pull request is merged, run a new candidate from `main`.

### Local development build

```bash
./start9/build.sh
```

This builds the checked-in version without changing it. Use the resulting `start9/hoseki-sentinel.s9pk` for local sideload testing.

### Private remote candidate

Run **Release 2 - Build candidates** manually from the repository's Actions page and select the branch to test. The workflow captures that run's exact commit; there is no separate source-ref input. It:

1. runs the complete repository verification suite;
2. verifies that the source tree is clean and the version graph is valid;
3. builds one universal x86_64/aarch64 StartOS package and native macOS ARM64 and Windows x64 installers from the same commit;
4. verifies the StartOS package ID, version, architectures, and clean Git hash, and desktop's embedded version and source identity;
5. smoke-tests each desktop package's backend, native SQLite, frontend assets, dynamically assigned port, local Electrum fixture, and bundled Tor executable;
6. uploads the `.s9pk`, `.dmg`, and `.exe` in separate Actions artifacts with checksums and desktop build metadata, retained for 14 days.

Candidate runs do not change the version, create a tag, create a GitHub Release, or publish to a StartOS registry. The StartOS candidate filename includes both the official tag form and the source commit, for example:

```text
hoseki-sentinel-v0.2.1_0-0123456789ab.s9pk
```

Desktop artifacts are named `desktop-mac-arm64` and `desktop-win-x64`. Their installer filenames contain the release tag and target platform; accompanying `mac.json` / `win.json` records the exact commit. The candidate's native desktop jobs run alongside the StartOS verification/build job. Ordinary pull-request and `main` CI also run these native desktop builds and smoke tests. The Mac target is Apple Silicon only, matching its bundled Tor binary.

If the repository secret `STARTOS_DEV_KEY` is absent, the workflow creates a temporary signing key. That is suitable for clean-install testing, but it must not be used to test signer continuity or upgrades. Configure a permanent StartOS developer key as that secret before testing upgrades between remote builds. Never print, commit, or attach the key.

### Version preparation

Version changes belong in their own pull request. In GitHub, open **Actions**, choose **Release 1 - Prepare version**, and select **Run workflow** from the default branch. The form asks only for a release type: `patch`, `minor`, `major`, or `revision`.

The workflow calculates the next version and exact StartOS tag, rejects existing tag or branch names, and opens a pull request containing a generated version file. That file intentionally starts with a release-notes placeholder. The pull request's CI check remains failing until the placeholder is replaced, preventing unreviewed or flattened notes from reaching a package. The workflow does not create a tag or package.

For example, starting from `0.2.1:0`:

| Selection  | New version | Exact future tag |
| ---------- | ----------- | ---------------- |
| `patch`    | `0.2.2:0`   | `v0.2.2_0`       |
| `minor`    | `0.3.0:0`   | `v0.3.0_0`       |
| `major`    | `1.0.0:0`   | `v1.0.0_0`       |
| `revision` | `0.2.1:1`   | `v0.2.1_1`       |

In the generated pull request, open the new file under `start9/startos/versions/` from **Files changed**, select **Edit file**, and replace the placeholder with multiline release notes using this format:

```ts
releaseNotes: `Brief user-facing summary.

- First change.
- Second change.

Any important compatibility note.`,
```

Commit that edit directly to the release branch. Keep a blank line before the list and put every bullet on its own line. The CI check will rerun and pass once the placeholder is gone and the version graph remains valid.

The version file is the source of the notes displayed by StartOS and copied into the eventual GitHub Release. Editing only the pull-request description does not change the packaged notes. GitHub may require a maintainer to select **Approve workflows to run** before protected checks start on an automation-created pull request.

The equivalent local commands remain available for maintenance and recovery:

```bash
node start9/scripts/version.mjs bump patch --notes "Add custom portfolio date ranges."
node start9/scripts/version.mjs bump minor --notes "Add a substantial new account capability."
node start9/scripts/version.mjs bump major --notes "Describe the compatibility break."
node start9/scripts/version.mjs bump revision --notes "Rebuild StartOS packaging."
```

Commit the version graph before producing any release candidate intended to have a clean package Git hash. `./start9/build.sh` still accepts the bump options for backwards compatibility, but routine local builds should omit them.

### Downloadable draft GitHub Release

After the version pull request is merged and its candidate is tested, open **Actions**, choose **Release 3 - Create draft release**, and run it from the default branch. There is no version or tag field. The workflow:

1. derives the only valid tag from the committed version graph;
2. rejects an existing tag or GitHub Release;
3. uses the permanent `STARTOS_DEV_KEY` when configured, otherwise creates a temporary signing key;
4. runs the complete verification suite and rebuilds all platforms from the default-branch commit captured when the workflow starts, even if the branch moves while builds run;
5. waits for both native desktop packages and smoke tests to pass, then verifies the StartOS package ID, version, architectures, source commit, release notes, and checksum;
6. verifies that both desktop manifests match that exact release and commit, rejects dirty builds or altered installer checksums, and assembles all assets;
7. creates an exact-tagged **draft** GitHub Release containing the `.s9pk`, `.dmg`, `.exe`, `DESKTOP_BUILDS.json`, and combined `SHA256SUMS`.

The product release notes are read back from the StartOS package. GitHub's draft adds packaging/signing details for the included desktop assets. When a temporary StartOS key is used, the GitHub Release also displays a warning that the package is intended for clean installs and testing, not signer-continuous upgrades. Review the draft and checksums before publishing it. The workflow does not publish to a StartOS registry.

Desktop installers currently use ad-hoc macOS signing without notarization and have no Windows publisher signature. They are review builds and can produce operating-system installation warnings. Native runtime tests do not verify the installer UI, physical wallets, or preservation of existing data across upgrades. Developer ID/notarization, Windows signing, and automatic updates remain separate work. Do not treat a packaging-only revision as a separately ordered desktop application version; the full revision is tracked in the build metadata.

A permanent StartOS developer signing key is not required to create a downloadable draft release. Configure `STARTOS_DEV_KEY` before using these builds to test upgrades or before publishing to a StartOS registry. Once deployed packages rely on a permanent signer, preserve that key to retain signer continuity.

### StartOS registry publication (future)

Registry publication remains intentionally separate from version preparation and GitHub Releases. Add it only after the registry destination, credentials, signing continuity, and upgrade testing are confirmed. It should consume the already-tagged release rather than calculate a new version or rebuild from an unrelated commit.

StartOS does not need to issue a signing key for private candidate builds. The permanent developer key is controlled by this project and must be kept secret. Before testing signer-continuous upgrades or publishing to a registry, securely configure the existing key as the `STARTOS_DEV_KEY` GitHub repository secret; do not generate a replacement if an installed package already relies on the existing signer. Clean-install candidates and draft GitHub Releases can use the temporary-key path described above.

The official Community Registry submission process is a separate, later step. StartOS currently asks maintainers to email `submissions@start9.com` with a link to a public GitHub repository. StartOS then reviews and forks the repository into the `Start9-Community` organization. Merges there publish automatically to `community-beta`; production promotion happens only after the maintainer gives approval. See the [StartOS publishing guide](https://docs.start9.com/packaging/0.4.0.x/publishing.html) and [Start9 Community instructions](https://github.com/Start9-Community#for-developers-submitting-a-package).

### Publication docket

- [ ] Complete a clean-install candidate test on a real StartOS device.
- [ ] Finish the StartOS pre-publish checklist, including install, startup, UI, health, uninstall, and reinstall testing.
- [ ] Securely configure the existing permanent developer key as `STARTOS_DEV_KEY`.
- [ ] Build two consecutive signed candidates and verify upgrade/signing continuity.
- [ ] Back up an existing installation and verify that an upgrade preserves the `main` volume and application data.
- [ ] Review the repository for public release readiness, including documentation, licenses, security guidance, and secret history.
- [ ] Make the GitHub repository public only when the project is ready for StartOS review.
- [ ] Email `submissions@start9.com` with the public repository link and request Community Registry review.
- [ ] Address StartOS review feedback in the future `Start9-Community` fork.
- [ ] Test the automatically published `community-beta` package on real hardware.
- [ ] Give StartOS approval to promote the tested beta build to the production Community Registry.

## Source identity and cache isolation

The reusable [desktop build](../.github/workflows/build-desktop.yml), [candidate workflow](../.github/workflows/startos-candidate.yml), and [draft-release workflow](../.github/workflows/startos-draft-release.yml) check out `github.sha` and verify the checkout before invoking repository code. Desktop has no independent `source_ref` input. The draft-release source job requires the default branch and records the exact event commit; downstream checks require that same identity, even if the branch later moves. A PR run can use GitHub's test-merge commit, so read the artifact's recorded SHA rather than assuming it equals the branch tip.

All three workflows set `cache-mode: none` and call the shared setup action with `cache: 'false'`. Both settings matter: the workflow denies shared cache access, while the action input avoids attempting cache restore/save operations. Ordinary CI verification retains its shared cache. Re-enabling caches or adding an independently selected checkout changes the security boundary reviewed by CodeQL.

Native desktop packaging verifies the embedded release/version/source identity and writes platform metadata and checksums. Draft assembly waits for both desktop jobs and rejects mismatched commits or versions, dirty sources, missing or unexpected installers, and altered checksums before attaching all three platforms to one draft. See the [assembly checks](../.github/scripts/assemble-desktop-release.cjs).

Actionlint 1.7.12 predates the `cache-mode` workflow key. When using that version, exclude only its unsupported-key diagnostic and keep every other rule enabled:

```bash
actionlint -ignore '^unexpected key "cache-mode" for "workflow" section\.'
```

Remove that compatibility exception when the installed actionlint recognizes the key. Record build evidence and manual acceptance results in the relevant pull request or release, including the artifact's version, source commit, and tested operating system.

## Compatibility invariants

The package ID `hoseki-sentinel` and persistent volume `main` are part of the installed-service identity. Do not rename either without an explicit data migration and upgrade-compatibility plan. Release testing should include an upgrade from the last published package with its existing `main` volume, not only a clean installation.

Preserve desktop's application ID and local data location, Sentinel's database migrations, and existing StartOS configuration keys. Test desktop upgrades and complete-data backups/restores with synthetic encrypted credentials before relying on them for existing installations.
