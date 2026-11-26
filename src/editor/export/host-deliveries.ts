/**
 * What a share can do inside the Lite host's container: Xiaohongshu's album and note composer.
 * Another host's build aliases its own module here (`scripts/edition-build.mts:LITE_HOST_ALIASES`), so
 * one container's bridge never ships in another's package.
 */
import { deliverToXiaohongshu, xiaohongshuImageActionAvailable } from './xiaohongshu';
import type { HostMark } from './brand';
import type { I18nKey } from '../../i18n/keys';
import type { ResolutionKey } from '../../io/export/facts';

interface HostDelivery {
  id: string;
  labelKey: I18nKey;
  /** Whether the container offers it now; asked on every render, since a bridge can arrive late. */
  available: () => boolean;
  send: (image: Blob) => Promise<void>;
}

/** A link that opens the map, where the container shares one. */
interface HostMapLink {
  labelKey: I18nKey;
  /** Whether the container shares links here; one answer per page. */
  offered: () => Promise<boolean>;
  share: () => Promise<void>;
  /** The map code the page was opened with, taken off its address. */
  arriving: () => string | null;
}

export const HOST_DELIVERIES: readonly HostDelivery[] = [
  { id: 'save', labelKey: 'lite.save_album', available: () => xiaohongshuImageActionAvailable('save'), send: (image) => deliverToXiaohongshu(image, 'save') },
  { id: 'note', labelKey: 'lite.open_note', available: () => xiaohongshuImageActionAvailable('note'), send: (image) => deliverToXiaohongshu(image, 'note') },
];

/** Xiaohongshu shares the picture, never a link. */
export const HOST_MAP_LINK: HostMapLink | null = null;

/** The footer QR the container makes for a picture size, in place of the site's; Xiaohongshu makes none. */
export const HOST_FOOTER_MARK: ((resolution: ResolutionKey) => Promise<HostMark | null>) | null = null;
