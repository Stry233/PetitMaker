/* The maker's band's words and lockup, shared by the preview and the export. The site is the
 * deployment's canonical origin, which the caller reads from `legal/` (it ranks above this layer);
 * lockups are self-contained SVG banner assets. */
import { brandName } from '../../i18n/terms/brand';
import { loadImage } from '../../platform/async/load-image';
import { translateFor } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import { isImportable, type ExportOptions, type ResolutionKey } from '../../io/export/types';
import { RESOLUTION_WIDTHS } from '../../io/export/compose';
import { brandQrSideAt } from '../../io/export/brand-band';
import type { CompositionAssets } from '../../io/export/paint';
import type { I18nKey } from '../../i18n/keys';

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
    p = loadImage(url).catch(() => null);
    cache.set(url, p);
  }
  return Promise.race([
    p,
    new Promise<null>((resolve) => { setTimeout(() => resolve(null), LOCKUP_WAIT_MS); }),
  ]);
}

/** A QR the deployment's host made for one of its own pages, and the words the band shows beside it. */
export interface HostMark { qr: CanvasImageSource; url: string; labelKey: I18nKey }

/** The footer QR's side, in px, at a size, for a map `nativeWidth` px wide at Native: a preset's
 *  width is fixed, Native's is the map's own with High's as its floor. */
export function footerQrSide(resolution: ResolutionKey, nativeWidth: number): number {
  return brandQrSideAt(resolution === 'original' ? Math.max(RESOLUTION_WIDTHS.high, nativeWidth) : RESOLUTION_WIDTHS[resolution]);
}

/** The band's words and target for `CompositionAssets.brand`. `site` is the deployment's origin, named
 *  only under the site mark, or the mark the host made, which the band always carries. */
export function brandInfo(
  locale: Locale,
  options: Pick<ExportOptions, 'preset'>,
  lockup: HTMLImageElement | null,
  site: string | HostMark,
  siteMark: boolean = EXPORT_SITE_MARK,
): CompositionAssets['brand'] {
  if (typeof site !== 'string') {
    return { lockup, url: site.url, label: translateFor(locale, site.labelKey), powerText: translateFor(locale, 'export.brand_made', { app: brandName(locale) }), qr: site.qr };
  }
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
