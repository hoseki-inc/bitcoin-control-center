# Patina-derived Result core

This directory contains the TypeScript source and tests of `@patina/core@3.0.0`,
from [Patina v3.0.0](https://github.com/bkiac/patina/tree/v3.0.0)
(commit `546eb31f070753f5fb8c1a9df7385b9b03399a64`). The upstream code is
licensed under MIT; see [LICENSE](./LICENSE).

The implementation and regression tests include the merged Hoseki Services
Result stack through commit `c930e85e7` (PRs #2335–#2381), ported from
`origin/main` at `718d334fd` for
[issue #143](https://github.com/hoseki-inc/bitcoin-control-center/issues/143).
Control Center retains its existing directory layout and formatting; the core
is now locally maintained and checked by the repository's lint rules.

Method documentation and examples are adapted from Rust's
[`Result`](https://github.com/rust-lang/rust/blob/1.90.0/library/core/src/result.rs)
and [`Option`](https://github.com/rust-lang/rust/blob/1.90.0/library/core/src/option.rs)
documentation at release `1.90.0` and describe this implementation's behavior.

See the [consumer guide](../../README.md) for usage and migration notes.
