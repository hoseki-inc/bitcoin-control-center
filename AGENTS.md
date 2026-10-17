# Agent guidance

Bitcoin Control Center is a standalone, local-first product. Sentinel is its only backend; do not reintroduce imports or compatibility endpoints for Hoseki Services or `api-armadillo`.

## Product direction

Help people **understand, grow, protect, and eventually use their Bitcoin savings**. This is the preferred framing for product descriptions and future feature planning.

Design around Bitcoin as a long-term savings asset, with accounting and planning that support that use. Keep current capabilities distinct from the broader product mission when describing the app.

## Safety

- Do not commit or push unless the user explicitly asks.
- Do not change the StartOS manifest ID `hoseki-sentinel` or persistent volume `main` without an explicit migration plan.
- Do not log descriptors, exchange credentials, encryption keys, or full external API responses containing secrets.

## Commands

```bash
pnpm dev
pnpm check
pnpm test
pnpm build
./start9/build.sh
./desktop/build.sh
```

## Code conventions

- Before adding a StartOS wrapper migration, run `node start9/scripts/version.mjs bump revision`; keep released migration files and their helpers immutable.

- Give exported functions explicit return types.
- Prefer `Result` values to exceptions for expected failures.
- Use `parse` or `parseUnknown` from `@hoseki/packages/result/lib/parse` instead of Zod's `.parse()` or `.safeParse()`.
- Use Chakra's `textStyle` typography tokens instead of separate `fontSize` and `lineHeight` props.
- Install exact dependency versions with `pnpm add -E` or `pnpm add -wDE`.

## Product boundary

- Product and API behavior belongs in `apps/api-sentinel`.
- Shared UI and wallet logic belongs in `packages` only when used by Control Center.
- Distribution-specific configuration belongs in `start9`, `desktop`, or a future platform package such as `umbrel`.
- New functionality must preserve local storage, auditability, and the absence of an implicit cloud service.

## Issue #91 lint rollout

- Introduce one lint rule at a time, in the order listed in issue #91 unless the user chooses a different order.
- Keep each rule's configuration and repository-wide fixes in its own commit. Do not bundle other rules or unrelated refactors into that commit.
- Automatically fix, validate, and commit each rule with ten or fewer violations when all fixes are straightforward, then continue to the next rule. Stop before fixing a rule with more than ten violations or any complex fixes. Do not push or open a PR until the user asks.
- Run the accumulated lint checks and the relevant type checks, tests, and builds before committing each rule.
- Keep Oxlint's default rule categories disabled; enable rules explicitly so each checkpoint adds only the rule under review.
- Apply rules to all maintained source, including desktop, StartOS, tests, and repository scripts.
- After the user confirms a lint PR is merged and asks to continue, update main and remove the completed worktree after verifying it has no uncommitted or unpushed work. Preserve branch history and any unfinished work, and start the next rule in a new worktree.
