# Bitcoin glyph fallback

`InterVariable.woff2` is the unmodified Inter variable font downloaded from
https://rsms.me/inter/font-files/InterVariable.woff2 on 2026-09-07.
The accompanying `LICENSE.txt` is from https://github.com/rsms/inter.

The bundled Geist and Geist Mono fonts lack U+20BF (₿). `bitcoin.css` supplies
Inter only for that code point in both families, including chart labels and
settings previews. Other characters keep their existing font. The asset is
bundled locally and requires no external font service at runtime.
