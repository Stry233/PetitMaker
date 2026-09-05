# PetitGlyph raster fixtures

The PNG files preserve decoded JPEG pixels so the tests do not need an installed image codec. Each image retains the complete share code. Expected payload lengths and SHA-256 digests are pinned in `recovery.test.ts` independently of the encoder.

- `legacy-v2-author.png`: the complete 1488×360 version 2 code from the author’s Chinese README image, preserving its existing JPEG artifacts as lossless PNG pixels. The payload is 3,724 bytes. Its catalog identity predates the current catalog.
- `social-1080-double-jpeg.png`: the credited README island, exported at Standard size (1600×1876), resized as a complete image with Lanczos to 921×1080, encoded as JPEG quality 70 with 4:2:0 chroma subsampling, then re-encoded at quality 65 with the same sampling. The payload is 3,702 bytes.
- `dense-1080-jpeg75.png`: the deterministic adversarial map from `corpus.ts`, placed in the same 1600×1876 composition with its 1488×312 band at (56, 1244), resized as a complete image with Lanczos to 921×1080, then encoded as JPEG quality 75 with 4:2:0 chroma subsampling. The payload is 6,879 bytes.

Both codec pipelines used ImageMagick 7.1.2-30. The README map and its attribution match `docs/media/share-map.png`; the dense fixture substitutes synthetic map data only in the band. These samples measure image transformations, not a named platform's upload behavior.
