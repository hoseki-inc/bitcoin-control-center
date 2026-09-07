---
target: App-wide UI critique
total_score: 23
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-09-07T13-44-12Z
slug: apps-control-center-src
---

Method: dual-agent (A: /root/design_review · B: /root/evidence_review), with parent motion review and independent mobile viewport verification.

The strongest opportunity is to make Bitcoin Control Center feel like one deliberate holdings product. The restrained foundation is good; the hierarchy, terminology, and completion flows still carry a statement-first product identity.

Scope: app-wide source review, shared theme/components, desktop screenshots of Home, Add Account, and Settings, and true 390px mobile emulation of Home and statement creation. This is a design critique, not implementation or a completed accessibility test. Scores are provisional; hardware signing, all populated detail states, keyboard traversal, and real devices were not exercised.

## Design specificity

Geist, quiet borders, and modest radii fit the product. Changing fonts or adding effects would not resolve its main weaknesses. Its distinctive quality should be clear answers to: what do I hold, where is it held, how current is it, and what has been verified?

The visible header still says Hoseki while its alternative text says Bitcoin Control Center. A product-specific wordmark would help establish the standalone identity; any Hoseki endorsement can be secondary. This is a visible-brand proposal and does not imply changing backend or StartOS identifiers.

## Design health

| Heuristic           | Score / 4 | Main finding                                                                                 |
| ------------------- | --------- | -------------------------------------------------------------------------------------------- |
| System status       | 2         | Portfolio has useful status handling; unavailable Home can show zero holdings.               |
| Real-world language | 2         | Accounts, My Holdings, and claims compete; connected and verified need clearer distinction.  |
| User control        | 2         | Back/cancel paths exist; manual-account removal immediately mutates.                         |
| Consistency         | 2         | Shared tokens coexist with different page frames, headings, and error treatment.             |
| Error prevention    | 2         | Good settings safeguards; destructive removal and misleading date correction need attention. |
| Recognition         | 3         | Named navigation, providers, and amount previews help.                                       |
| Efficiency          | 2         | Portfolio filtering is useful; account cards and duplicate overview routes add work.         |
| Minimalist design   | 3         | Calm foundation, but statement promotion competes with holdings.                             |
| Error recovery      | 2         | Some retries are good; Home and receipt recovery are inconsistent.                           |
| Help                | 3         | Wallet guidance exists; source selection needs better orientation.                           |
| **Total**           | **23/40** | **Acceptable, with substantial opportunities.**                                              |

## What works

- Settings is the best internal reference: clear sectional layout, restrained typography, equivalent amount previews, and explicit save behavior.
- The shared Geist family, tabular amounts, radius roles, and visible focus treatment provide a coherent foundation.
- Portfolio already distinguishes stale data, incomplete history, sync activity, and unavailable USD values. Carry that precision into other screens.

## Five priorities

### 1. P1: Make financial states and destructive actions unambiguous

Home passes `unavailable` into DashboardPreview, but its balance, fiat value, and counts check only `loading`. A failed request can therefore look like zero holdings. This is source-confirmed, not a simulated browser error test. Sources: `apps/control-center/src/pages/index.tsx:38` and `components/dashboard/dashboard-preview.tsx:27`.

Give loading, empty, unavailable, and stale-with-data distinct presentations. Show dashes plus a persistent explanation/retry for unavailable values, retain healthy sections, and avoid rendering statement-empty promotions while data is unresolved.

Also distinguish connected exchanges, ownership-verified wallets, and manual holdings in labels. Manual-account removal directly calls its mutation from a top-bar action (`pages/claims/manual/[id].tsx:139`, `:159`); give it consistent destructive confirmation with the account name and consequences. No removal was performed.

Suggested command: `$impeccable harden`.

### 2. P1: Make holdings the center of the application

Home and Portfolio overlap, and both place Generate Statement prominently. Home also adds a statement promotion. Empty Home places a full market-price chart before Add Account. These priorities conflict with the confirmed portfolio-first audience.

Sources: `pages/index.tsx:63`, `:106`; `pages/dashboard/index.tsx:562`; `components/dashboard/dashboard-preview.tsx:51`; `components/dashboard/banner.tsx:49`.

My recommendation is one primary Portfolio overview, with deeper analysis available within it. Lead with total holdings, the selected period's change, account scope, and freshness. Keep market price as secondary context. Statements remain a dedicated destination and quiet utility action. On first use, lead with Add Account and concise watch-only reassurance.

Suggested command: `$impeccable distill`.

### 3. P2: Turn the account chooser into a clear decision

The rendered chooser shows ten equally weighted tiles mixing device brands, exchanges, multisig, and manual entry. The large tiles require scanning without explaining the categories. Source: `components/claims/add-account-flow.tsx:48`.

Use three labeled groups: Wallets, Exchanges, and Manually tracked holdings. Provide direct compact choices within each, with a short explanation of what will be connected or recorded. Put descriptor import and multisig under wallet options. Keep experienced-user paths direct.

Three hardware-logo slots were blank in the capture while local logos rendered. That does not prove permanent asset failure, but bundling those assets locally would remove the remote-loading dependency. Standardize Accounts/My Holdings/Connect New Account terminology.

Suggested command: `$impeccable onboard`.

### 4. P2: Establish a stronger type and layout hierarchy

The app uses consistent ingredients but gives different content similar emphasis. Page headings and Home's principal amount are both 24px, while some receipt headings reach 52px and explanatory copy reaches 24px. Sources: `packages/ui/design-system/page-heading.tsx:12`, `apps/control-center/src/components/dashboard/dashboard-typography.tsx:17`, `packages/ui/prove-verify-ui/receipt.tsx:39`.

Define semantic roles: principal amount, page title, section heading, body, and metadata. Keep Geist; try a 32–40px desktop principal amount, 28–32px narrow-screen amount, 24px page headings, 16–18px section headings, and 14–16px body text, using shared textStyle tokens. These are starting points for a visual pass, not mandatory dimensions everywhere.

Use a deliberate wide dashboard frame and a narrower form frame, with predictable title/navigation alignment. Prefer dividers and spacing over nested panels where the content already groups naturally. Offer account rows with left-aligned identity and right-aligned balances for comparison.

True 390px emulation confirmed Home fits its viewport. Statement creation also has no horizontal overflow, but its empty state visibly squeezes prose into a narrow column alongside the document image. Stack explanation above content at narrow widths; populated form date/contact layouts need the same responsive treatment. Source: `pages/statements/create.tsx:147`.

Suggested commands: `$impeccable typeset`, `$impeccable layout`, `$impeccable adapt`.

### 5. P1: Make motion follow state instead of delaying it

The statement modal waits for a 1-second entrance, then a 4-second Lottie animation, before allowing the completed or failed screen to appear. This is visible in `components/full-transition-modal.tsx:41` and `:72`; the asset's 240 frames at 60 fps confirm its four-second duration. This is a code-derived timing chain, not a measured end-to-end generation time.

Several verification/connection receipts use five-second fireworks; some add an artificial 1.7-second pending state. CSS reduced-motion rules and MotionConfig do not stop these Lottie/canvas effects. The installed canvas-confetti default leaves reduced-motion suppression disabled, and these call sites do not override it.

Show actual success or failure immediately. Keep confirmation local and brief, with a clear next step. Explicitly gate canvas/Lottie effects and staged JavaScript timers on reduced motion. Functional QR animation must retain its data-transfer role.

Use Emil's restraint for frequent actions, Jakub's subtle polish for transitions, and Jhey-style playfulness only for an optional rare milestone. A short 150–220ms transition can help disclosures, copied-state feedback, or loading-to-content continuity. Do not animate every navigation, add balance-counting theatrics, or delay controls for decoration. Not every conditional render needs animation.

Suggested command: `$impeccable animate`.

## Smaller improvements

- Make normal fiat balances neutral. Reserve directional green/red for change; manual provenance should not resemble a warning by default.
- Show time-of-day freshness for intraday Bitcoin prices; the current footer formats only a date (`bitcoin-price-chart.tsx:123`).
- Review chart tick precision: the loaded mobile Home capture shows distinct positions with identical rounded BTC labels.
- Correct the reversed start/end-date recovery sentence (`pages/statements/create.tsx:110`) and show it by the inputs.
- Associate desktop Electrum inputs with proper labels (`pages/settings/index.tsx:337` onward). This desktop-only surface was reviewed in source, not rendered.
- Give successful account verification a natural View Portfolio ending when entered from account addition. Preserve statement-specific continuation when entered from statement creation.

## Cognitive load, personas, and emotional journey

Account selection has the clearest grouping/hierarchy problem. Five or six familiar chart ranges are not automatically a usability defect; collapsing them merely to satisfy a numeric checklist could make exploration worse.

- Jordan, a first-time holder, must translate mixed account categories and the difference between tracking and proving ownership.
- Alex, a frequent user, has overlapping overview routes, repeated statement prompts, and large cards that slow balance comparison.
- Sam, a keyboard or motion-sensitive user, needs the JS animation gaps fixed and the narrow form layouts checked at zoom; keyboard and screen-reader interaction remain untested.

The current journey starts calmly, loses clarity at account selection, and ends with more statement ceremony than the primary job needs. The desired emotional outcome is quiet confidence: accounts are connected, values are understandable, freshness is visible, and the next step is obvious.

## Deterministic evidence

The required CLI detector completed with two warnings, both `overused-font`, at `apps/control-center/src/fonts/inter/bitcoin.css:5` and `:14`. These are contextually false positives: the declarations provide Bitcoin-glyph fallback using a restricted Unicode range. They do not justify replacing Geist. The scanner did not identify the main hierarchy, state, motion, or responsive issues and is not an accessibility certification.

## Decisions for the next pass

1. Consolidate Home and Portfolio into one holdings destination, or retain Home as a deliberately compact summary with Portfolio reserved for analysis? Recommendation: consolidate.
2. Replace the prominent Hoseki wordmark with Bitcoin Control Center, or retain Hoseki as the primary visible brand? Recommendation: product-specific identity with an optional secondary Hoseki endorsement.
