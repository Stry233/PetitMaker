/*
 * asset-list.ts — the full art enumeration, in its own module ON PURPOSE: an eager `?url` glob
 * becomes one import per file in dev (350+ requests revalidated on every reload), so this module
 * must never sit in the boot-critical graph. `preload.ts` imports it dynamically, only on the
 * cold boot that is about to fetch everything anyway; a warm boot never loads it.
 */
import { allIconUrls } from '../../../assets/icon-urls';

const shellArt = import.meta.glob('../../../assets/shell/**/*.{png,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const cursorArt = import.meta.glob('../../../assets/cursors/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Every art URL the splash warms, deduplicated. Small assets Vite inlines as `data:` URIs are
 *  excluded: they already live in the bundle, and fetching a data: URL trips the CSP's
 *  connect-src (which rightly names no data: scheme). */
export function splashAssetUrls(): string[] {
  return [...new Set([
    ...allIconUrls(),
    ...Object.values(shellArt),
    ...Object.values(cursorArt),
    // The mastheads live in public/ under stable names — the boot loader references them before
    // any bundle exists, and the splash reuses the SAME URLs so the art is never fetched twice.
    `${import.meta.env.BASE_URL}banner.svg`,
    `${import.meta.env.BASE_URL}banner-zh.svg`,
  ])].filter((url) => !url.startsWith('data:'));
}
