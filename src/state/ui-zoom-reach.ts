/**
 * The UI scale's reach: the largest scale the window as it stands still answers to. It is read off
 * the laid-out window, so the interface publishes it (one page-wide registration, as it publishes
 * the live dock) and the store clamps every caller's scale to it; with none published the whole
 * range is in reach.
 */
import { UI_ZOOM_MAX } from '../platform/storage/prefs';

let published: (() => number) | null = null;

/** Registers the page's reading of the reach; returns the unregister. */
export function registerUiZoomReach(read: () => number): () => void {
  published = read;
  return () => { if (published === read) published = null; };
}

export function uiZoomReach(): number {
  return published ? published() : UI_ZOOM_MAX;
}
