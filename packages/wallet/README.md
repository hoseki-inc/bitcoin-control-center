# `packages/wallet`

Adapters and validation at the boundary between **external wallet data** (user input, exports, hardware devices)
and our **core Bitcoin domain** (`packages/bitcoin`).

This package exists to keep `packages/bitcoin` strict and predictable while still supporting real-world wallet
formats and exports.

## What does NOT belong here

- Core Bitcoin parsing/modeling (that stays in `packages/bitcoin`)
- Business-specific application logic (keep this package a thin boundary/adapter)

## Usage guidelines

- **User-provided xpub**: use `Slip132.getXpubFromString(...)` (not `bitcoin.Xpub.fromString(...)`).
- **User-provided descriptor / wallet export**: use `WalletImporter.*FromDescriptor(...)` so we:
  - validate checksum if present
  - normalize SLIP-132 keys
  - enforce signing requirements (derivation-path sufficiency)

## Examples

Parse any supported extended pubkey format:

```ts
import { Slip132 } from '../wallet'

const xpubRes = Slip132.getXpubFromString('Zpub...')
```

Import a descriptor that may include SLIP-132 keys and/or a checksum:

```ts
import { WalletImporter } from '../wallet'

const walletRes = WalletImporter.multisigFromDescriptor('wsh(sortedmulti(2,[...]Ypub.../<0;1>/*,...))#checksum')
```
