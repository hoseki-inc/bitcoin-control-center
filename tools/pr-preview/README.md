# PR preview

Runs `main` and each open redesign PR side by side on your machine, all with the same fictional data, and opens a page that compares any PR with `main` on the same screen.

## Run it

From the repository root:

```bash
tools/pr-preview/start.sh
```

The first run fetches `main` and each PR, then installs and builds each one, which takes a few minutes. Later runs fetch again and rebuild only what changed. The page opens when everything is up. Press Ctrl-C to stop every preview.

You need:

- Node.js 22.23.3 or newer and pnpm 10 (`corepack enable`)
- Read access to this repository, because PRs are fetched as `pull/<number>/head` from `origin`
- Ports 3500–3510 free. Set `PREVIEW_BASE_PORT` to use another range.

## Using the page

- Pick a PR on the left. The left pane shows `main` and the right pane shows the PR, on the same screen.
- **Screen** switches both panes to the same page. Type any path into the box to go somewhere else.
- **Width** frames both at desktop, laptop or phone width, scaled to fit.
- The ↗ link above a pane opens that version full size in its own tab.
- `index.html#pr154` opens a PR directly.

Each pane shows the commit it runs.

## What runs

Each target in `targets.tsv` gets its own worktree under `.work/worktrees`, its own Sentinel on its own port serving that branch's built UI, and its own data under `.work/data`. Nothing touches your checkout's `apps/api-sentinel/data`.

Sentinel connects to the Electrum server in your `apps/api-sentinel/.env`. Without one, it uses Blockstream's public server. The sample data has no on-chain accounts, so no addresses are sent to either.

## Sample data

All fictional: two manual accounts, Cold Storage and Savings Vault, with a year of activity, and an ETF account, Brokerage IRA, holding IBIT and FBTC.

Onboarding (#51) only appears on a fresh install, so #51 and the `main (no accounts)` target start empty.

## Limits

- PRs run as last pushed, not merged with current `main`.
- Generating a statement needs a verified wallet or exchange, which the sample data doesn't have. So the statement date changes in #45, and the statement half of #52, can't be seen.
- Account detail pages have different IDs on each side. Open an account from the Accounts list in each pane.

## Options

| Command | What it does |
| --- | --- |
| `start.sh --reset-data` | Start every preview from fresh sample data |
| `start.sh --no-open` | Don't open the page |
| `start.sh --clean` | Remove the preview worktrees and data |

To change which PRs are compared, edit `targets.tsv`, and add a description for any new PR to the `prs` list in `index.html`.
