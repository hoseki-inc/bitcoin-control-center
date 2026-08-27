ARCHES := x86 arm
include s9pk.mk

# start-cli cannot discover the remaining package ingredients until the bundled
# StartOS definition exists. Make that bootstrap dependency explicit so builds
# also work from a fresh clone where javascript/ is absent.
$(BASE_NAME).s9pk: javascript/index.js
$(BASE_NAME)_%.s9pk: javascript/index.js
