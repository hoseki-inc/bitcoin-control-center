# Vendored Patina core

This directory contains the TypeScript source and tests of `@patina/core@3.0.0`,
from [Patina v3.0.0](https://github.com/bkiac/patina/tree/v3.0.0)
(commit `546eb31f070753f5fb8c1a9df7385b9b03399a64`). The upstream code is
licensed under MIT; see [LICENSE](./LICENSE).

The source is formatted to match this repository. Test imports point to the
local entry point, and upstream concurrent test groups run sequentially to
avoid mock resets across tests under Vitest 5. The snapshot has scoped lint
exemptions so its implementation remains faithful to v3.0.0. Behavior changes
belong in the follow-up to
[issue #143](https://github.com/hoseki-inc/bitcoin-control-center/issues/143).
