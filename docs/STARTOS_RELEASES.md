# StartOS build and release model

Bitcoin Control Center keeps the StartOS version graph in `start9/startos/versions/`. That checked-in graph is the only source of truth for the package version. Builds and Git tags must follow it; a workflow must never invent or silently increment a version.

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
| `patch`    | `0.2.1:0` -> `0.2.2:0` | Compatible application fix or maintenance release      |
| `minor`    | `0.2.1:0` -> `0.3.0:0` | Compatible feature release                             |
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

# Fail unless a proposed release tag exactly matches the graph.
node start9/scripts/version.mjs assert-tag v0.2.1_0
```

`npm --prefix start9 run check`, ordinary pull-request CI, and `./start9/build.sh` all validate the graph. A malformed, duplicated, missing, or out-of-order version cannot pass those gates.

## Build types

### Local development build

```bash
./start9/build.sh
```

This builds the checked-in version without changing it. Use the resulting `start9/hoseki-sentinel.s9pk` for local sideload testing.

### Private remote candidate

Run the **StartOS candidate** workflow manually from the repository's Actions page and choose the branch or commit to test. The workflow:

1. runs the complete repository verification suite;
2. verifies that the source tree is clean and the version graph is valid;
3. builds one universal x86_64/aarch64 package;
4. verifies the package ID, version, architectures, and clean Git hash;
5. uploads the `.s9pk` and `SHA256SUMS` as a private Actions artifact for 14 days.

Candidate runs do not change the version, create a tag, create a GitHub Release, or publish to a StartOS registry. Their artifact name includes both the official tag form and the source commit, for example:

```text
hoseki-sentinel-v0.2.1_0-0123456789ab.s9pk
```

If the repository secret `STARTOS_DEV_KEY` is absent, the workflow creates an ephemeral signing key. That is convenient for clean-install testing, but it must not be treated as a release artifact or used to test signer continuity. Configure the existing StartOS developer key as that secret before testing upgrades between remote builds. Never print, commit, or attach the key.

### Version preparation

Version changes belong in their own pull request. In GitHub, open **Actions**, choose **Prepare StartOS release**, and select **Run workflow** from the default branch. The form asks for:

- a release type: `patch`, `minor`, `major`, or `revision`;
- release notes describing the user-visible changes.

The workflow calculates the next version and exact StartOS tag, formats and validates the version graph, rejects existing tag or branch names, commits the generated version files to a release branch, and opens a pull request. It does not create a tag or package.

For example, starting from `0.2.1:0`:

| Selection  | New version | Exact future tag |
| ---------- | ----------- | ---------------- |
| `patch`    | `0.2.2:0`   | `v0.2.2_0`       |
| `minor`    | `0.3.0:0`   | `v0.3.0_0`       |
| `major`    | `1.0.0:0`   | `v1.0.0_0`       |
| `revision` | `0.2.1:1`   | `v0.2.1_1`       |

Review and polish the release notes in the generated version file before merging. GitHub may require a maintainer to select **Approve workflows to run** before protected pull-request checks start on an automation-created pull request.

The equivalent local commands remain available for maintenance and recovery:

```bash
node start9/scripts/version.mjs bump patch --notes "Fix account history refresh."
node start9/scripts/version.mjs bump minor --notes "Add a new account source."
node start9/scripts/version.mjs bump major --notes "Describe the compatibility break."
node start9/scripts/version.mjs bump revision --notes "Rebuild StartOS packaging."
```

Commit the version graph before producing any release candidate intended to have a clean package Git hash. `./start9/build.sh` still accepts the bump options for backwards compatibility, but routine local builds should omit them.

### Signed draft GitHub Release

After the version pull request is merged and its candidate is tested, open **Actions**, choose **StartOS draft release**, and run it from the default branch. There is no version or tag field. The workflow:

1. derives the only valid tag from the committed version graph;
2. rejects an existing tag or GitHub Release;
3. requires the permanent `STARTOS_DEV_KEY` with no ephemeral fallback;
4. runs the complete verification suite and rebuilds from the protected default-branch commit;
5. verifies the package ID, version, architectures, source commit, release notes, and checksum;
6. creates an exact-tagged **draft** GitHub Release containing the signed `.s9pk` and `SHA256SUMS`.

The release notes are read back from the built package, so the StartOS manifest and GitHub Release cannot silently diverge. Review the draft and checksum before publishing it. The workflow does not publish to a StartOS registry.

The draft workflow will not run until the existing permanent StartOS developer signing key is stored as the `STARTOS_DEV_KEY` repository secret. Never generate a new release key if deployed packages must retain signer continuity.

### StartOS registry publication (future)

Registry publication remains intentionally separate from version preparation and GitHub Releases. Add it only after the registry destination, credentials, signing continuity, and upgrade testing are confirmed. It should consume the already-tagged release rather than calculate a new version or rebuild from an unrelated commit.

## Compatibility invariants

The package ID `hoseki-sentinel` and persistent volume `main` are part of the installed-service identity. Do not rename either without an explicit data migration and upgrade-compatibility plan. Release testing should include an upgrade from the last published package with its existing `main` volume, not only a clean installation.
