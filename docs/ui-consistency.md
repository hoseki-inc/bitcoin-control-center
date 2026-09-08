# Control Center UI conventions

The visual reference is the Geist-based `apps/web-marketing` implementation in
`hoseki-inc/hoseki-services`, reviewed September 7, 2026. Its theme, home hero,
global CSS, and button source inform the treatment here. Reference code is not a
runtime dependency; Sentinel remains the only backend.

## Shared rules

- Use self-hosted Geist for interface text and Geist Mono for financial data and
  identifiers. Use 400, 500, and 600 weights. Use `PageHeading` for page titles:
  `text/2xl` at 500, with a `text/md` subtitle 4px below. All main pages include a
  subtitle. Section titles use `text/xl`; body and supporting copy use `text/sm`.
- Use the Chakra spacing scale: 8px within groups, 16px between related elements,
  24px panel padding, and 32px between sections. Mobile may use 16px outer padding.
- Use `control` (8px), `panel` (12px), and `dialog` (16px) radius tokens. Circular
  avatars and status indicators keep their existing shape.
- Use the shared primary, outline, and ghost buttons. Default controls are 44px
  high. Small data filters can use the shared smaller sizes.
- Use neutral.600 for supporting copy on white and neutral.500 for subdued text.
  Pale neutrals are for borders and decorative elements, not essential labels.
- Use `EmptyView` for initial empty states: no icons, a `text/xl` medium-weight
  title, `text/md` explanation 8px below, and one next action. Distinguish empty
  data from errors.
- Use fades on statement previews and blur behind dialogs. Controls and content
  must remain independently visible and interactive. Respect reduced motion.

## Review findings addressed

- Conflicting 4/5/8/10/12px corners and ad hoc button sizing: shared radius and
  control tokens, consistent account and statement panels.
- Bold headings, generic monospace fallback, and faint labels: lighter heading
  hierarchy, explicit Geist Mono mapping, and stronger text contrast.
- Header crowding and no active route indication: responsive navigation,
  `aria-current` state, consistent content gutters, and a 44px settings target.
- Blank circles and oversized statement artwork as empty states: shared,
  actionable Accounts, Portfolio, and Statements states.
- Click-only Add Account tile, hover-only statement action, and unlabeled view
  toggle: native button semantics, persistent View action, accessible labels.
- Oversized introduction and ineffective dismissal in its large mode: compact
  responsive preview and an explicit dismiss control in every mode.
- Abrupt hover transitions, moving account cards, and indefinite success pulse:
  restrained color transitions and reduced-motion support.
- Statements descriptions referring to partner APIs: wording now describes the
  local product's saved statements.

## Verification boundaries

Browser discovery returned no available browser in this session. Rendered mobile
and desktop inspection, keyboard walkthroughs, zoom, and real wallet interactions
still need verification. The configured Electrum server also timed out during
startup. Static checks and unit tests do not establish visual or hardware QA.
