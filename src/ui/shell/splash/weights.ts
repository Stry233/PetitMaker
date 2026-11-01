/**
 * What each item the splash counts weighs in its progress: its size in bytes from the build's size
 * manifest (`platform/build/asset-sizes.ts`), so a 5 MB font moves the bar as far as two hundred
 * 25 KB icons together. An item the manifest cannot name falls back to a typical size of its kind.
 */
import { ASSET_SIZES_FILE, type AssetSizes } from '../../../platform/build/asset-sizes';
import { withDeadline } from '../../../platform/async/abort';

/** The longest the splash waits for the manifest before weighing by kind: nothing fetches until it
 *  answers, so a stalled request must not hold the art. */
const MANIFEST_WAIT_MS = 3000;

type ItemKind = 'art' | 'font' | 'file' | 'code';

/** Byte weights for an item the manifest does not list: the median size of each kind in a 2026-10
 *  web build. A code item is a warm loader whose chunk graph the manifest cannot attribute. */
export const FALLBACK_BYTES: Readonly<Record<ItemKind, number>> = {
  art: 24_000,
  font: 1_500_000,
  file: 128_000,
  code: 128_000,
};

/** Bytes an item of `kind` at `url` weighs. */
type Weigh = (kind: ItemKind, url?: string) => number;

/** The manifest's key for `url`: its path under the page's base. */
function manifestKey(url: string): string {
  const here = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  const base = new URL(import.meta.env.BASE_URL, here).pathname;
  const path = decodeURI(new URL(url, here).pathname);
  return path.startsWith(base) ? path.slice(base.length) : path.replace(/^\//, '');
}

/** The weighing for this build: reads the size manifest once; a missing, unreadable or slow manifest
 *  leaves every item at its kind's fallback. Never rejects. */
export async function loadWeights(signal?: AbortSignal): Promise<Weigh> {
  const deadline = withDeadline(MANIFEST_WAIT_MS, signal);
  const read = async (): Promise<AssetSizes> => {
    const response = await fetch(`${import.meta.env.BASE_URL}${ASSET_SIZES_FILE}`, { cache: 'no-cache', signal: deadline.signal });
    const parsed: unknown = response.ok ? await response.json() : null;
    return parsed && typeof parsed === 'object' ? parsed as AssetSizes : {};
  };
  const expired = new Promise<AssetSizes>((resolve) => { deadline.signal.addEventListener('abort', () => resolve({}), { once: true }); });
  let sizes: AssetSizes;
  try { sizes = await Promise.race([read(), expired]); } catch { sizes = {}; } finally { deadline.dispose(); }
  return (kind, url) => {
    if (kind === 'code' || !url) return FALLBACK_BYTES[kind];
    let size: unknown;
    try { size = sizes[manifestKey(url)]; } catch { size = undefined; }
    return typeof size === 'number' && size > 0 ? size : FALLBACK_BYTES[kind];
  };
}
