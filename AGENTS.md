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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
