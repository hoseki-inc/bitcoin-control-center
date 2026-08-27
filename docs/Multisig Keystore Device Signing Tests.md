| **Device** | **Multisig Script Type**   | **Expected Derivation Path** | **Address Script Type shown by Device** | **Notes**                                        |
| ---------- | -------------------------- | ---------------------------- | --------------------------------------- | ------------------------------------------------ |
| Trezor     | P2SH (Legacy)              | m/45'/0/0                    | N/A                                     | **"Forbidden key path" error**                   |
| Trezor     | P2SH-P2WSH (Nested SegWit) | m/48'/0'/0'/1'/0/0           | P2SH                                    | _"Wrong address path selected for coin" warning_ |
| Trezor     | P2WSH (Native SegWit)      | m/48'/0'/0'/2'/0/0           | P2WPKH                                  | _"Wrong address path selected for coin" warning_ |
| Trezor     | Nonstandard                | m/0'/0'/0'/0/0               | N/A                                     | **"Forbidden key path" error**                   |
| Ledger     | P2SH (Legacy)              | m/45'/0/0                    | N/A                                     | Shows derivation path, instead of address        |
| Ledger     | P2SH-P2WSH (Nested SegWit) | m/48'/0'/0'/1'/0/0           | N/A                                     | Shows derivation path, instead of address        |
| Ledger     | P2WSH (Native SegWit)      | m/48'/0'/0'/2'/0/0           | N/A                                     | Shows derivation path, instead of address        |
| Ledger     | Nonstandard                | m/0'/0'/0'/0/0               | N/A                                     | Shows derivation path, instead of address        |
| Coldcard   | P2SH (Legacy)              | m/45'/0/0                    | P2PKH                                   |                                                  |
| Coldcard   | P2SH-P2WSH (Nested SegWit) | m/48'/0'/0'/1'/0/0           | P2PKH                                   |                                                  |
| Coldcard   | P2WSH (Native SegWit)      | m/48'/0'/0'/2'/0/0           | P2PKH                                   |                                                  |
| Coldcard   | Nonstandard                | m/0'/0'/0/0                  | P2PKH                                   |                                                  |

Coldcard has an option to pass in address format in both TXT and JSON format, but this did not work for me with a custom path. It seems to only work when the derivation path match the address format, i.e., p2wpkh + m/84'/0'/0'/0/0.
