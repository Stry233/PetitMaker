/**
 * The Bilibili Toy build's deliveries (`host-deliveries.ts`), over `bilibili-toy.ts`:
 * Save picture keeps the picture in the App's album or downloads it in a web browser, Share link opens
 * the App's share panel, and the picture's footer QR is the Toy's own.
 */
import * as Toy from './bilibili-toy';
import type * as Host from './host-deliveries';

export const HOST_DELIVERIES: typeof Host.HOST_DELIVERIES = [
  { id: 'save', labelKey: 'lite.save_picture', available: () => true, send: Toy.saveToyPicture },
];

export const HOST_MAP_LINK: typeof Host.HOST_MAP_LINK = {
  labelKey: 'lite.share_link', offered: Toy.toyShares, share: Toy.shareToyMapLink, arriving: Toy.takeArrivingMapCode,
};

export const HOST_FOOTER_MARK: typeof Host.HOST_FOOTER_MARK = Toy.toyFooterMark;
