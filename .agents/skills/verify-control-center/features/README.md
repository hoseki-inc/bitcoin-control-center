# Control Center verification map

[`map.json`](./map.json) lists every user-facing feature, grouped by area. A feature's `recipes` list names its recipe files in this directory and the sub-features each one `proves`: read the recipe before driving it. How to launch, drive and record a run is in [SKILL.md](../SKILL.md).

## The map

- Each feature has an `id`, what the user does, its routes, what it `needs` before this skill can drive it, and its sub-features.
- Each sub-feature has an `id` (unique within its feature), a kind (`happy`, `failure` or `edge`), what the app should do, and its own `needs` where that differs from the feature's. `needs` uses the keys defined at the top of the file.
- Sub-features describe what the app should do. One that fails when driven is a finding, not a map error.
- The map says what exists and what it needs. What passed lives in each run's `report.md`.

### Keeping the map current

- A change that adds or changes user-facing behavior updates `map.json` in the same change: a new feature or sub-feature, a changed route, or a changed `needs`.
- A recipe can come later. A new recipe gets an entry in its feature's `recipes` list with the sub-features it proves, in the same change.
- When a change alters what a recipe drives (a label, a step, a route), update the recipe in the same change.
- `apps/control-center/src/routes.test.tsx` fails when an app page has no feature here, or a route here names no page. Copy routes exactly as the app declares them.

## Recipe contract

Each recipe starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order; a test checks the headings.

1. `Sub-features` has one line, `Proves:` followed by the sub-feature IDs in backticks. They must match the recipe's `proves` list in `map.json` exactly; a test checks it. Their descriptions stay in the map.
2. `How to get to it (user POV)` lists every user entry point, and says which ones this recipe drives.
3. `Driving it with the browser`, or `Driving it with CDP (<launch command>)` for a recipe that needs the packaged Electron app, starts with `Preconditions:` and uses labeled bullets that pair each user action with the handle to use and the observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

Keep implementation details out. Name only user paths, stable handles, required state and observable proof.
