/**
 * The shipped font files as `fonts.css` declares them, and their registration on the page. The web
 * app registers them from script instead of importing the stylesheet so that a cold visit can fetch
 * its interface art first: text laid out under a registered face requests that face's file at once,
 * ahead of images. Development harnesses still import `fonts.css` directly.
 */
import css from './fonts.css?raw';

const FILES = import.meta.glob('./*.woff2', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface FontFile {
  family: string;
  weight: number;
  /** The `font-display` the stylesheet declares (`swap` when it declares none). */
  display: FontDisplay;
  /** The file's served URL. */
  url: string;
}

/** One `@font-face` block read into a face, or null when the block lacks a family, weight or a shipped
 *  file: a stylesheet written another way loses that face, never the page's boot. */
function readFace(block: string): FontFile | null {
  const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
  const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1]);
  const file = /url\('\.\/([^']+)'\)/.exec(block)?.[1];
  const url = file === undefined ? undefined : FILES[`./${file}`];
  const display = (/font-display:\s*([a-z]+)/.exec(block)?.[1] ?? 'swap') as FontDisplay;
  return family && weight > 0 && url ? { family, weight, display, url } : null;
}

/** Every face `fonts.css` declares, with its file's served URL. */
export const FONT_FILES: readonly FontFile[] = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)]
  .map(([, block]) => readFace(block!))
  .filter((face): face is FontFile => face !== null);

/** The faces registered on this page, by file URL: the one record of which faces exist and are
 *  loading, so no caller fetches a registered face's file beside the browser's own load. */
const registered = new Map<string, FontFace>();

function fontFacesSupported(): boolean {
  return typeof document !== 'undefined' && typeof FontFace !== 'undefined' && typeof document.fonts?.add === 'function';
}

/** Registers `files` (every face by default) on the page, each once. A browser without the FontFace
 *  API keeps the fallback families of the stack. */
export function installFontFaces(files: readonly FontFile[] = FONT_FILES): void {
  if (!fontFacesSupported()) return;
  for (const { family, weight, display, url } of files) {
    if (registered.has(url)) continue;
    const face = new FontFace(family, `url(${JSON.stringify(url)}) format('woff2')`, { weight: String(weight), display });
    registered.set(url, face);
    document.fonts.add(face);
  }
}

/** Whether `file`'s face is registered on the page (and so loads, or has loaded, through the browser). */
export function fontFaceRegistered(file: FontFile): boolean {
  return registered.has(file.url);
}

/** Loads `file`'s registered face, joining a load already running; whether it loaded. An unregistered
 *  face answers false without fetching anything. */
export async function loadFontFace(file: FontFile): Promise<boolean> {
  const face = registered.get(file.url);
  if (!face) return false;
  try { await face.load(); return true; } catch { return false; }
}

/** Test hook: forget the registration. */
export function __resetFontFaces(): void {
  registered.clear();
}
