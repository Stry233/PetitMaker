/**
 * The build's size manifest, written beside `index.html`: every file the page may warm, by its
 * base-relative path, with its size in bytes as served before compression. The development server
 * answers the same path from the source tree (`scripts/warm-build.mts:assetSizeManifest`).
 */
export const ASSET_SIZES_FILE = 'asset-sizes.json';

/** The manifest's shape: base-relative path to byte size. */
export type AssetSizes = Readonly<Record<string, number>>;
