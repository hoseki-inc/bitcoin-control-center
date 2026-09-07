# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individual Bitcoin holders tracking their own holdings. Portfolio tracking is the primary job; proving control and generating statements are supporting workflows. This priority was confirmed by the product owner during initialization.

## Product Purpose

Bitcoin Control Center brings a holder's Bitcoin accounts together so they can understand balances, follow holdings over time, and create downloadable portfolio and proof-of-reserves statements. Success means users can track their own holdings without a Hoseki cloud account or hosted application backend.

## Positioning

A standalone, local-first, watch-only Bitcoin portfolio tracker with supporting ownership-verification and statement workflows. Sentinel is its only application backend. Portfolio data and encrypted exchange credentials are stored locally, with direct connections to Electrum and supported external APIs.

## Operating Context

- The same React interface runs in a browser, as a StartOS service, and inside an Electron desktop application for macOS and Windows. The desktop wrapper does not change the interface's web platform classification.
- Users add self-custody accounts, supported exchange accounts, or manually maintained Bitcoin and ETF holdings, then review balances and history in the portfolio.
- Users can prove control of self-custody accounts through signed-message challenges and generate downloadable statements as needed.
- Local-first does not mean offline-only: Electrum, exchange, and market-data connections support the relevant workflows. Users can select their Electrum server.
- Local development starts with `pnpm dev`; the frontend normally runs at `http://localhost:4269` and Sentinel at `http://localhost:3400`. The portfolio route is `/portfolio`.

## Capabilities and Constraints

- Track self-custody accounts using descriptors and extended public keys, with Ledger, Trezor, Coldcard, and Keystone workflows.
- Track supported Coinbase, Kraken, Robinhood, and Strike accounts, plus manually maintained Bitcoin and ETF holdings.
- Record balance history locally and show Bitcoin market-price history separately from portfolio holdings.
- Preserve watch-only operation. Wallet seeds and private keys do not belong in the application.
- Store portfolio data in local SQLite and encrypt exchange credentials locally. Preserve local storage, auditability, and the absence of an implicit cloud service.
- Do not reintroduce Hoseki Services or `api-armadillo` imports or compatibility endpoints. Hosted authentication, billing, sharing, and telemetry are outside the repository's stated product boundary.
- Product and API behavior belongs in `apps/api-sentinel`; shared code in `packages` must serve Control Center. Distribution configuration belongs in `start9`, `desktop`, or a future platform package.
- Preserve the StartOS manifest ID `hoseki-sentinel` and persistent volume `main` unless an explicit migration plan authorizes a change.
- Never log descriptors, exchange credentials, encryption keys, or full external API responses containing secrets.
- Chromium-based browsers are required for WebHID hardware-wallet workflows.

## Brand Commitments

The product name is Bitcoin Control Center. Keep Hoseki as the visible brand. Sentinel names the backend. Existing product copy uses accounts, holdings, portfolio, and statements as user-facing concepts.

## Evidence on Hand

- `README.md`: product capabilities, architecture, local development, distribution, and privacy boundaries.
- `AGENTS.md`: implementation conventions and product safety constraints.
- `apps/control-center/src/routes.tsx`: portfolio, account, verification, statement, multisig, and settings workflows.
- `apps/control-center/src/components/dashboard/dashboard-preview.tsx`: the empty-portfolio experience and account-addition entry point.
- `apps/control-center/src/components/dashboard/bitcoin-price-chart.tsx`: market-price history, range selection, and unavailable-data handling.
- `packages/ui/design-system`: incumbent shared UI implementation. Init does not establish a replacement visual system.

No customer testimonials, adoption metrics, or performance claims were supplied during initialization. Do not invent them.

## Product Principles

1. Make personal holdings easy to understand; keep statements a supporting workflow. Keep Home and Portfolio separate: Home is a quick overview, Portfolio supports detailed analysis.
2. Keep users' portfolio data local and external service dependencies explicit.
3. Preserve watch-only safety and the distinction between tracking holdings and proving control.
4. Keep balances, market prices, and unavailable data distinguishable so users can interpret what they see.
5. Maintain one product across browser, StartOS, and desktop distributions while respecting their operating constraints.

## Open Decisions

No additional audience segments, formal voice guidelines, or product-specific accessibility conformance target were established during initialization. Existing accessibility behavior, including reduced-motion handling and labeled controls, remains implementation evidence to preserve.
