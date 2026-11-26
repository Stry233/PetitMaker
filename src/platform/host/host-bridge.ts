/**
 * What the Lite host's container offers the app beyond the page: a check of the text a player types,
 * the player's name on the platform, the container's screen mode, and its album, share panel and QR
 * codes. The web edition and a host without them bridge nothing; a host's build aliases its own module
 * here (`scripts/edition-build.mts:LITE_HOST_ALIASES`), so one container's SDK calls never ship in another's package.
 */

/** A host check's answer on one text; `unavailable` means the check did not run and never passes. */
type HostTextVerdict = 'ok' | 'rejected' | 'unavailable' | 'too-long';

/** The container's check of `text`, typed at the entry point `scene`; null where the host has none. */
export const checkHostText: ((text: string, scene: string) => Promise<HostTextVerdict>) | null = null;

/** The player's name on the platform, or null when it gives none. Called only from a press, since the
 *  platform may first ask the player's consent; null where the host has no profile. */
export const readHostProfileName: (() => Promise<string | null>) | null = null;

/** The room the container gives the page, in css px: its viewport and the insets interactive content keeps clear of. */
export interface HostScreenSpace {
  width: number;
  height: number;
  insets: { top: number; right: number; bottom: number; left: number };
}

/** Asks the container for its landscape immersive mode, listening first, and reports the room it gives
 *  while a state shows that mode, null while none does; returns the stop function. Null where the host has no screen mode. */
export const watchHostScreen: ((listener: (space: HostScreenSpace | null) => void) => () => void) | null = null;

/** The container's sharing abilities: its album, its share panel and the QR codes it makes of its own pages. */
export type HostShareAbility = 'album' | 'share' | 'qr';

/** Whether the container offers `ability` on this page, which its own app and a web browser answer
 *  differently; false where it cannot answer. Null where the host shares nothing itself. */
export const hostOffers: ((ability: HostShareAbility) => Promise<boolean>) | null = null;

/** Saves a picture, a PNG, JPEG or WebP data URI, to the container's album, `hint` saying why where it
 *  asks the player's permission; one past the album's limit throws `delivery-limit.ts:DeliveryLimitError`
 *  and is never sent. Null where the host has no album. */
export const saveHostAlbum: ((dataUrl: string, hint?: string) => Promise<void>) | null = null;

/** Opens the container's share panel on its page at `path`, relative to the package's root; a path
 *  leaving the package throws. Null where the host has no share panel. */
export const shareHostPage: ((path: string) => Promise<void>) | null = null;

/** A QR the container made: a PNG data URI and the address it encodes. */
interface HostQr { dataUrl: string; url: string }

/** The container's QR for its page at `path`, `size` px square as near as it draws, or null where it
 *  makes none here. Null where the host makes no QR codes. */
export const hostQrCode: ((path: string, size: number) => Promise<HostQr | null>) | null = null;
