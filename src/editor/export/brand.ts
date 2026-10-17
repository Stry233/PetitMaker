/* The maker's band's words and lockup, shared by the preview and the export. The site is the
 * deployment's canonical origin, which the caller reads from `legal/` (it ranks above this layer);
 * lockups are self-contained SVG banner assets. */
import { brandName } from '../../i18n/terms/brand';
import { translateFor } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import { isImportable, type ExportOptions } from '../../io/export/types';
import type { CompositionAssets } from '../../io/export/paint';

/** The zh lockup leads with the CJK wordmark; every other locale reads the Latin one. */
function lockupUrl(locale: Locale): string {
  const file = locale === 'zh' ? 'banner-zh.svg' : 'banner.svg';
  return `${import.meta.env.BASE_URL}${file}`;
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** Maximum wait for a lockup image before rendering the text fallback. */
const LOCKUP_WAIT_MS = 250;

/** The deploy-time `PETIT_EXPORT_SITE_MARK=1` choice. Unset and bare-test builds omit it. */
const EXPORT_SITE_MARK = typeof __PETIT_EXPORT_SITE_MARK__ === 'boolean'
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

/** The band's words and target for `CompositionAssets.brand`; `site` is named only under the site mark. */
export function brandInfo(
  locale: Locale,
  options: Pick<ExportOptions, 'preset'>,
  lockup: HTMLImageElement | null,
  site: string,
  siteMark: boolean = EXPORT_SITE_MARK,
): CompositionAssets['brand'] {
  const url = siteMark ? site : '';
  return {
    lockup,
    url,
    label: url.replace(/^https?:\/\//, ''),
    powerText: isImportable(options) && siteMark
      ? translateFor(locale, 'export.brand_import')
      : translateFor(locale, 'export.brand_made', { app: brandName(locale) }),
  };
}
