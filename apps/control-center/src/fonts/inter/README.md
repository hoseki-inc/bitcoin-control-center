# Bitcoin glyph fallback

`InterBitcoin.woff2` contains only U+20BF (₿) and the supporting variable-font
weight data (100–900). It is a 1,908-byte subset of the 352,240-byte Inter variable
font downloaded from https://rsms.me/inter/font-files/InterVariable.woff2 on
2026-09-07. The original SIL Open Font License is retained in `LICENSE.txt`.

The bundled Geist and Geist Mono fonts lack U+20BF. `bitcoin.css` supplies the
subset for that code point in both families, including chart labels and settings
previews. Other characters keep their existing font. The asset is bundled locally
and requires no external font service at runtime.

To reproduce from the original file with FontTools 4.64.0 and Brotli 1.2.0:

```sh
pyftsubset InterVariable.woff2 --unicodes=U+20BF --flavor=woff2 \
  --output-file=InterBitcoin.woff2 --name-IDs='*' --name-languages='*'
```
