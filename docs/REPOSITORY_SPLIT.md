# Public repository extraction checklist

This working tree is the source boundary for Bitcoin Control Center, but its Git history still belongs to Hoseki Services. Complete these checks before publishing.

## Required before the first public push

- Export a clean snapshot of the final tree into a new Git repository. Do not push the `control-center` branch or any Hoseki Services refs.
- Run a secret scanner against both the snapshot and the new repository's initial commits.
- Confirm that every retained font, image, animation, wallet logo, Tor binary, and vendored asset can be redistributed under its applicable license.
- Replace or approve Hoseki-owned branding and support links that remain intentionally visible in the product.
- Set `packageRepo` and `upstreamRepo` in the StartOS manifest to the final public URL.
- Enable the checked-in Dependabot and dependency-review configuration, then configure branch protection, private vulnerability reporting, and release signing in the public repository.
- Run `pnpm ci`, the StartOS multi-architecture build, and both desktop packaging targets from a clean clone.

## Compatibility invariants

The public repository may change its GitHub organization and visible product name. These identifiers should remain stable unless a migration is designed and tested:

- StartOS manifest ID: `hoseki-sentinel`
- StartOS persistent volume: `main`
- Sentinel SQLite schema and migration behavior
- Existing StartOS configuration keys
- Desktop application ID and local data path

## Snapshot procedure

After the tree passes verification, create a sibling directory outside this Hoseki Services worktree, copy tracked files only, initialize a new repository, and make the public project's initial commit there. Creating the remote repository, pushing, and publishing releases are separate actions that require explicit authorization.
