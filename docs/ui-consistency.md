# Control Center UI conventions

Control Center is an OS-style shell of glass surfaces over a procedural wallpaper, in a
light and a dark theme. The craft reference is umbrelOS 2.0 (measured on a live device,
September 2026); every component is our own implementation. The earlier Geist reference
from `apps/web-marketing` still governs type. Sentinel remains the only backend.

## Themes and colour

- The appearance preference is System, Light or Dark, stored per browser
  (`control-center:appearance`) and applied before first paint by the script in
  `apps/control-center/index.html`. `AppearanceSync` keeps Chakra in step. The header
  pill, the desktop menu, search and Settings can all change it. Hide balances sits beside it
  in the top-right pill.
- Use semantic colour roles, never palette steps, in components:
  `text.primary|secondary|tertiary|disabled|inverse`, `border.subtle|strong|inverse`,
  `surface.base|raised|subtle|muted|emphasis|inverse|overlay`, `accent.*`,
  `status.{success,warning,error}.{fg,bg,border,solid}`, `chart.*` and `focus.ring`
  (`packages/ui/design-system/theme/foundation/semantic-tokens.ts`). Every role has a
  light and a dark value; a test checks that both resolve.
- The accent is Hoseki yellow in both themes, used as a fill with dark text (selected
  wallpaper, switches, the orb). Primary buttons are the inverse surface.
- Brand marks drawn for white backgrounds sit on a light chip in dark mode.

## Materials

Defined as CSS variables per mode in `theme/foundation/materials.ts`, with layer styles:

| Surface                                  | Layer style / component         | Notes                                                                         |
| ---------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| Menus, popovers, tooltips, search card   | `materialMenu`, `materialModal` | tint + `blur(20px)` + four-part shine                                         |
| Toasts                                   | `materialToast` (sonner style)  | lighter blur, softer shadow                                                   |
| Sheet windows                            | `window`, `windowChrome`        | a cached, blurred wallpaper snapshot under a tint; never a live backdrop blur |
| Cards and settings groups inside windows | `edge`                          | raised glass; replaces 1px bordered panels                                    |
| Dock and widgets                         | `<Glass>` + `useGlassPreset`    | SVG displacement refraction in Chromium, frosted elsewhere                    |
| Progress grooves, inset cells            | `glassTrack`, `glassCell`       | pressed-in wells                                                              |

Light glass is denser than dark glass: page text sits on it, so dark wallpaper regions
must not bleed through. With reduced transparency or increased contrast, every material
becomes opaque; without `backdrop-filter` support, tints thicken.

## Shell

- `/home` is the desktop: greeting, four widgets (Holdings, Bitcoin, Connections,
  Verified), and accounts as app icons. Every other route opens in one persistent sheet
  window that grows out of the dock; URLs and deep links are unchanged.
- The dock holds the five sections. It magnifies under a mouse
  only, shows labels on hover or focus, marks the current section with `aria-current`
  and a dot, and moves focus with the arrow keys.
- ⌘K / Ctrl+K opens search from anywhere after the welcome. Commands come from
  `shell/search/commands.tsx`; ranking is in `shell/search/score.ts`.
- Right-click an account icon or the desktop for context menus; they restore focus to
  where it was when they close.
- Holdings shows a dash, never a zero, while no balance is known. Keep balances, market
  prices and unavailable data distinguishable.

## Type, spacing and controls

- Geist for interface text and Geist Mono for financial data and identifiers, at 400,
  500 and 600. Use `textStyle` tokens. `PageHeading` for page titles with a subtitle.
  Live figures use tabular numerals.
- Chakra spacing: 8px within groups, 16px between related elements, 24px panel padding,
  32px between sections; 16px outer padding on mobile.
- Radii: `control` 8px, `panel` 16px, menus 20px, modals 24px, windows 40px (24px below
  `lg`). Buttons are pills, 44px high by default.
- Use `SegmentedControl` for a small set of exclusive options; it is a radio group with
  a sliding selection. Switches are Hoseki yellow when on.
- `EmptyView` for initial empty states: a `text/xl` title, one explanation, one action.

## Motion

Tokens are in `packages/ui/design-system/animations/motion.ts`.

| Moment                      | Values                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| Sheet open / close          | 300ms `(.23,1,.32,1)` from `y 28, scale .94`; 200ms `(.32,.72,0,1)` to `y 20, scale .96`            |
| Wallpaper reveal and change | unblur and zoom from 1.25, 700ms; crossfade from a snapshot                                         |
| Desktop entrance            | widgets move only; icons fade and grow from .75, 200ms, 10ms stagger; dock rises on a 200/20 spring |
| Dock                        | magnify 50 → 80px on `{ mass .1, stiffness 150, damping 10 }`; 400ms launch bounce                  |
| Search                      | overlay 150ms; orb rises 380ms; card 240ms; height glides 260ms                                     |
| Selection pills             | spring `{ duration .4, bounce .2 }`                                                                 |

Under reduced motion: the wallpaper and orb are still, the dock does not magnify,
widgets do not tilt, the theme switch has no reveal, and transforms collapse to fades.
Wallpaper rendering pauses while a sheet covers it or the tab is hidden.

## Verification boundaries

Unit tests cover tokens, the glass map, wallpaper presets, totals, the shell, the
desktop, search and Settings. Rendered checks so far used Chrome on macOS with the
window in the background, so animations were inspected at their end state rather than
in motion. Safari and Firefox fallbacks, the Electron window, real reduced-motion and
reduced-transparency settings, and hardware wallet flows inside sheets still need a
hands-on pass.
