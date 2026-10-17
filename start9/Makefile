ARCHES := x86 arm
# Keep the repository checks: package files, the version graph, then TypeScript.
TS_CHECK := npm run check
# The repository formats start9/ with oxfmt (`corepack pnpm format:check`), not Prettier.
FORMAT_CHECK := true
include s9pk.mk

# start-cli cannot discover the remaining package ingredients until the bundled
# StartOS definition exists. Make that bootstrap dependency explicit so builds
# also work from a fresh clone where javascript/ is absent.
$(BASE_NAME).s9pk: javascript/index.js
$(BASE_NAME)_%.s9pk: javascript/index.js
