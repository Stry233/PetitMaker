// The share window's Bilibili Toy actions over the live map, through the container's bridge
// (`platform/host/host-bridge.ts`): the picture to the App's album or a download, the map's link to the
// App's share panel, the footer's QR, and the map a link arrives with.
import { qrReadableAt } from '../../io/export/brand-band';
import { downloadBlob, exportFileName } from '../../io/export/download';
import { exportableState } from '../../io/export/exportable';
import { mapNativePx } from '../../io/export/sizing';
import { mapLinkCode, mapLinkFor, withoutMapLink } from '../../io/share';
import { CURRENT_VERSION } from '../../io/save/format';
import { APP_VERSION } from '../../platform/build/build-info';
import { SUPPORTS_PICTURE_DOWNLOAD } from '../../platform/build/edition';
import { loadImage } from '../../platform/async/load-image';
import { blobToDataUrl } from '../../platform/remote/data-url';
import { hostOffers, hostQrCode, saveHostAlbum, shareHostPage, type HostShareAbility } from '../../platform/host/host-bridge';
import { showToast } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { planetNaming } from '../session/planet-names';
import { footerQrSide, type HostMark } from './brand';
import type { ResolutionKey } from '../../io/export/types';

/** The Toy's entry page, which every link and QR opens. */
const TOY_PAGE = 'index.html';

const offered = (ability: HostShareAbility): Promise<boolean> => hostOffers?.(ability) ?? Promise.resolve(false);

/** Whether the Toy can share a link here: in the App, not in a web browser. */
export const toyShares = (): Promise<boolean> => offered('share');

/** The live map's link path; null where the map is too large for a link or no map is open. */
async function liveMapLinkPath(): Promise<string | null> {
  const store = useEditorStore.getState();
  const state = store.gridState;
  if (!state) return null;
  const exportable = exportableState(state, planetNaming(store.locale));
  const summary = store.commandExecutor?.getProvenanceSummary() ?? null;
  return mapLinkFor(TOY_PAGE, exportable, summary, { appVersion: APP_VERSION, saveVersion: CURRENT_VERSION, createdAt: new Date().toISOString() });
}

/** Saves the picture to the App's album where the Toy has one, and as a download elsewhere. A picture
 *  past the album's limit throws `DeliveryLimitError` and is not sent. */
export async function saveToyPicture(image: Blob): Promise<void> {
  if (saveHostAlbum && await offered('album')) {
    await saveHostAlbum(await blobToDataUrl(image), translate('lite.album_permission'));
    return;
  }
  if (!SUPPORTS_PICTURE_DOWNLOAD) throw new Error('Picture download unavailable');
  downloadBlob(image, exportFileName([Date.now()], 'png'));
}

/** Opens the App's share panel with the live map's link. A map too large for a link is not shared,
 *  and a toast says so. */
export async function shareToyMapLink(): Promise<void> {
  const path = await liveMapLinkPath();
  if (!path) {
    showToast(translate('lite.link_too_large'), 'info');
    return;
  }
  if (!shareHostPage) throw new Error('Toy share unavailable');
  await shareHostPage(path);
  useEditorStore.getState().markExported(); // this map has now left the device
}

/** The footer's QR at a picture size, made by the Toy: the live map's link where its QR reads at the
 *  footer's size, the Toy's entry page otherwise; null where the Toy makes none. */
export async function toyFooterMark(resolution: ResolutionKey): Promise<HostMark | null> {
  const state = useEditorStore.getState().gridState;
  const side = footerQrSide(resolution, state ? mapNativePx(state.template).w : 0);
  try {
    const linked = await liveMapLinkPath();
    const readable = linked !== null && qrReadableAt(new URL(linked, location.href).href, side);
    const made = hostQrCode && await hostQrCode(readable ? linked : TOY_PAGE, side);
    const qr = made && await loadImage(made.dataUrl).catch(() => null);
    return made && qr ? { qr, url: made.url, labelKey: readable ? 'lite.qr_map' : 'lite.qr_toy' } : null;
  } catch (error) {
    console.error('[export] Toy QR unavailable', error);
    return null;
  }
}

/** The map code this page was opened with, taken off the address so a reload asks nothing again. */
export function takeArrivingMapCode(): string | null {
  const code = mapLinkCode(location.search);
  if (code !== null) history.replaceState(history.state, '', `${location.pathname}${withoutMapLink(location.search)}${location.hash}`);
  return code;
}
