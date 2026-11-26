/**
 * The Bilibili Toy build's container bridge (`host-bridge.ts`) and the one caller of the Toy SDK's
 * `window.toy`, which the entry page loads ahead of the app. A method the client lacks, or one that throws
 * or rejects (the web throws for App-only methods), counts as the bridge giving nothing. The SDK's errors
 * carry a `[ToySDK]` prefix.
 */
import type * as Host from './host-bridge';
import { DeliveryLimitError } from './delivery-limit';
import { parseRasterDataUrl } from '../remote/data-url';

interface ToyInsets { top?: number; right?: number; bottom?: number; left?: number }
interface ToyContainerState {
  orientation?: string;
  immersive?: boolean;
  viewport?: { width?: number; height?: number };
  safeArea?: ToyInsets;
  /** The top bar's box in immersive mode, which interactive content keeps clear of. */
  capsule?: { top?: number; left?: number; width?: number; height?: number };
}
interface ToySdk {
  checkInputSafety?(request: { text: string; scene?: string }): Promise<{ passed?: boolean; status?: string }>;
  getUserProfile?(): Promise<{ nickname?: unknown }>;
  onContainerChange?(listener: (state: ToyContainerState) => void): () => void;
  setContainerMode?(mode: { orientation?: 'portrait' | 'landscape' | 'auto'; immersive?: boolean }): Promise<void>;
  isSupport?(ability: string): Promise<boolean>;
  /** App only. `base64Data` may carry its data-URI prefix; over the limit the SDK throws. */
  saveImageToAlbum?(options: { base64Data: string; hintMsg?: string }): Promise<{ localPath: string }>;
  /** App only. `path` is relative to the Toy's root (`/toy/<slug>/`); a URL or `../` throws. */
  share?(options: { path: string }): Promise<void>;
  /** App and web. `base64` is a PNG data URI of a QR pointing at `url`, this Toy's page at `path`. */
  getQrCode?(options: { path?: string; size?: number }): Promise<{ base64?: string; url?: string }>;
}

const toy = (): ToySdk | null => (window as { toy?: ToySdk }).toy ?? null;

/** The check's own limits: the text in UTF-8 bytes, and a scene's characters and length. */
const TEXT_MAX_BYTES = 16384;
const SCENE = /^[A-Za-z0-9_.:-]{1,64}$/;

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

export const checkHostText: typeof Host.checkHostText = async (text, scene) => {
  const check = toy()?.checkInputSafety;
  if (!check || !text.trim()) return 'unavailable';
  if (utf8Bytes(text) > TEXT_MAX_BYTES) return 'too-long';
  try {
    const answer = await check.call(toy(), SCENE.test(scene) ? { text, scene } : { text });
    if (answer?.status === 'rejected') return 'rejected';
    return answer?.passed === true && answer.status === 'ok' ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
};

// Only the nickname is read: the profile's Toy user id is never kept or logged.
export const readHostProfileName: typeof Host.readHostProfileName = async () => {
  const read = toy()?.getUserProfile;
  if (!read) return null;
  try {
    const { nickname } = await read.call(toy());
    return typeof nickname === 'string' && nickname.trim() ? nickname.trim() : null;
  } catch {
    return null;
  }
};

const WANTED = { orientation: 'landscape', immersive: true } as const;
const size = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** The room `state` gives the page, or null when it does not show the mode asked for or names no viewport. */
function spaceOf(state: ToyContainerState): Host.HostScreenSpace | null {
  if (state.orientation !== WANTED.orientation || state.immersive !== WANTED.immersive) return null;
  const width = size(state.viewport?.width), height = size(state.viewport?.height);
  if (!width || !height) return null;
  const safe = state.safeArea ?? {};
  const bar = state.capsule;
  const barBottom = bar ? size(bar.top) + size(bar.height) : 0;
  return { width, height, insets: { top: Math.max(size(safe.top), barBottom), right: size(safe.right), bottom: size(safe.bottom), left: size(safe.left) } };
}

// The request resolving says nothing of the mode taking effect: only a state that shows it does.
export const watchHostScreen: typeof Host.watchHostScreen = (listener) => {
  const sdk = toy();
  if (!sdk?.onContainerChange || !sdk.setContainerMode) return () => {};
  let stop: () => void;
  try {
    stop = sdk.onContainerChange.call(sdk, (state) => listener(state ? spaceOf(state) : null));
  } catch {
    return () => {};
  }
  try {
    void Promise.resolve(sdk.setContainerMode.call(sdk, { ...WANTED })).catch(() => {});
  } catch {
    // A client that cannot switch keeps the state it reported; the listener already heard it.
  }
  return () => { try { stop(); } catch { /* nothing left to stop */ } };
};

/** The SDK's name for each sharing ability, as `toy.isSupport` takes it. */
const ABILITY = { album: 'saveImageToAlbum', share: 'share', qr: 'getQrCode' } as const;
/** The album's limit on `base64Data`, in characters with its prefix: the SDK's 5 MB read strictly. */
const ALBUM_LIMIT = 5_000_000;
/** The QR sizes the SDK draws, in px. */
const QR_SIZE = { min: 80, max: 1024 } as const;

/** Each SDK object's answers, asked once: the App and a web page answer differently, never in between. */
const answers = new WeakMap<object, Map<Host.HostShareAbility, Promise<boolean>>>();

function offers(ability: Host.HostShareAbility): Promise<boolean> {
  const sdk = toy();
  const name = ABILITY[ability];
  if (!sdk || typeof sdk.isSupport !== 'function' || typeof sdk[name] !== 'function') return Promise.resolve(false);
  let known = answers.get(sdk);
  if (!known) answers.set(sdk, known = new Map());
  let answer = known.get(ability);
  if (!answer) {
    answer = Promise.resolve().then(() => sdk.isSupport!(name)).then((yes) => yes === true, () => false);
    known.set(ability, answer);
  }
  return answer;
}

export const hostOffers: typeof Host.hostOffers = offers;

export const saveHostAlbum: typeof Host.saveHostAlbum = async (dataUrl, hint) => {
  if (!parseRasterDataUrl(dataUrl)) throw new Error('Invalid image');
  if (dataUrl.length > ALBUM_LIMIT) throw new DeliveryLimitError(dataUrl.length, ALBUM_LIMIT);
  if (!await offers('album')) throw new Error('Toy album unavailable');
  await toy()!.saveImageToAlbum!({ base64Data: dataUrl, ...(hint ? { hintMsg: hint } : {}) });
};

export const shareHostPage: typeof Host.shareHostPage = async (path) => {
  if (/^[a-z][a-z0-9+.-]*:|^\/|(?:^|\/)\.\.(?:\/|$)/i.test(path)) throw new Error('Toy paths stay inside the Toy');
  if (!await offers('share')) throw new Error('Toy share unavailable');
  await toy()!.share!({ path });
};

export const hostQrCode: typeof Host.hostQrCode = async (path, size) => {
  if (!await offers('qr')) return null;
  const side = Math.min(QR_SIZE.max, Math.max(QR_SIZE.min, Math.round(size)));
  const { base64, url } = await toy()!.getQrCode!({ path, size: side });
  return typeof base64 === 'string' && typeof url === 'string' && parseRasterDataUrl(base64) ? { dataUrl: base64, url } : null;
};
