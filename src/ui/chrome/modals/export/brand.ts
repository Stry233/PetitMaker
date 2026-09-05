/* Export attribution-band data shared by preview and final rendering. The optional site comes
 * from the active legal deployment target; lockups are self-contained SVG banner assets. */
import { LEGAL } from '../../../../legal/config';
import { brandName } from '../../../../version';
import { translateFor } from '../../../../i18n/context';
import type { Locale } from '../../../../core/model/types';
import type { ExportOptions } from '../../../../io/export/types';
import type { CompositionAssets } from '../../../../io/export/paint';

/** The zh lockup leads with the CJK wordmark; every other locale reads the Latin one. */
function lockupUrl(locale: Locale): string {
  const file = locale === 'zh' ? 'banner-zh.svg' : 'banner.svg';
  return `${import.meta.env.BASE_URL}${file}`;
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** Maximum wait for a lockup image before rendering the text fallback. */
const LOCKUP_WAIT_MS = 250;

/** The deploy-time `PETIT_EXPORT_SITE_MARK=1` choice. Unset and bare-test builds omit it. */
export const EXPORT_SITE_MARK = typeof __PETIT_EXPORT_SITE_MARK__ === 'boolean'
  ? __PETIT_EXPORT_SITE_MARK__
  : false;

/** Load and cache the locale lockup, returning null on failure or timeout. */
export function loadBrandLockup(locale: Locale): Promise<HTMLImageElement | null> {
  const url = lockupUrl(locale);
  let p = cache.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cache.set(url, p);
  }
  return Promise.race([
    p,
    new Promise<null>((resolve) => { setTimeout(() => resolve(null), LOCKUP_WAIT_MS); }),
  ]);
}

/** The band's words and target for `CompositionAssets.brand`. */
export function brandInfo(
  locale: Locale,
  options: Pick<ExportOptions, 'importable'>,
  lockup: HTMLImageElement | null,
  siteMark: boolean = EXPORT_SITE_MARK,
): CompositionAssets['brand'] {
  const url = siteMark ? LEGAL.canonicalOrigin : '';
  return {
    lockup,
    url,
    label: url.replace(/^https?:\/\//, ''),
    powerText: options.importable && siteMark
      ? translateFor(locale, 'export.brand_import')
      : translateFor(locale, 'export.brand_made', { app: brandName(locale) }),
  };
}
