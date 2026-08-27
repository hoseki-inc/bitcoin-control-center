# `packages/bitcoin`

Core Bitcoin domain + parsing utilities used across the monorepo.

This package intentionally stays **Bitcoin Core–compatible** and **pure**:

- It models Bitcoin concepts (`Address`, `Network`, `DerivationPath`, `Xpub`, …)
- It parses/serializes descriptors and related structures
- It does **not** try to accommodate quirks of external wallet exports

## What does NOT belong here

- **SLIP-132 parsing/normalization** (`ypub`, `zpub`, `Upub`, …)
  - `Xpub.fromString(...)` in this package accepts **only core `xpub`/`tpub`**
- **“Import boundary” validation** for external descriptors/exports (e.g. missing derivation paths)
- **Hardware wallet / vendor integration** and device-specific behavior

Those concerns live in `packages/wallet`.

## Examples

Create wallets from a core descriptor (core `xpub`/`tpub`, no SLIP-132):

```ts
import { Wallet } from '../bitcoin'

const res = Wallet.Multisig.fromDescriptor('wsh(sortedmulti(2,[abcd1234/48h/0h/0h/2h]xpub.../<0;1>/*,...))')
if (res.isOk()) {
  const wallet = res.unwrap()
  // ...
}
```

If you need to accept SLIP-132 keys or validate importability, use `packages/wallet`:

```ts
import { WalletImporter } from '../wallet'

const res = WalletImporter.multisigFromDescriptor('wsh(sortedmulti(2,[...]Zpub.../<0;1>/*,...))')
```
