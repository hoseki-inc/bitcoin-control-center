# Browser accessibility checks

`.oxlintrc.json` describes the HTML rendered by Chakra primitives and the `as` prop. These mappings apply to browser UI throughout the repository. `packages/pdf/.oxlintrc.json` inherits the rules but clears the mappings for the non-DOM PDF renderer; the preview restores them.

Oxlint 1.83 does not inherit plugin settings through `extends`, so the preview explicitly repeats the browser mappings. Keep both copies synchronized. Nested configs also explicitly preserve the plugin list and disabled default categories.

Keep mappings accurate when adding primitives or import aliases. Components that supply accessibility behavior internally are intentionally not mapped as bare HTML: `FormLabel` obtains `htmlFor` from `FormControl`, and `CloseButton`/`ModalCloseButton` supply their own accessible name. Their rendered behavior must be checked when changing those abstractions. Native labels and controls remain checked.

The label search depth of three includes text inside a layout wrapper. Router links use `to` for anchor validation; Oxlint's interaction rules do not infer the generated `href`, so the existing click-enabled router link has a narrowly documented suppression for those two rules only.

`packages/oxlint-config.test.ts` checks that browser mappings are loaded in each scope and do not apply to PDF-renderer images. UI regression tests cover single activation, native controls, and file-picker behavior. Keyboard activation and layout should also be checked in a browser when changing interactive cards.
