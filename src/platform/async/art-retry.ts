/**
 * Pictures whose load failed, held until a retry asks each to load again on its own element, so
 * whatever waits on that element (a sprite's fit, a texture's upload, a card's picture) carries on
 * when it lands. A host may serve packaged pictures from afar (the Xiaohongshu container's static
 * resource optimisation), where a picture can fail offline and arrive later.
 */
const held = new Map<HTMLImageElement, () => boolean>();
const listeners = new Set<() => void>();

/** Hold `image`, whose load just failed, for the next retry while `wanted` says so; its own error
 *  handlers hold it again if that load fails too. */
export function holdFailedImage(image: HTMLImageElement, wanted: () => boolean = () => true): void {
  held.set(image, wanted);
  for (const listener of listeners) listener();
}

/** Told whenever a failed picture is held; returns the unsubscribe. */
export function onImageHeld(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Whether any failed picture waits for a retry. */
export function imagesHeld(): boolean {
  return held.size > 0;
}

/** Loads every held picture again and lets go of them; those no longer wanted are dropped. Setting
 *  `src` again, even to the same address, makes the browser fetch a picture whose load failed. */
export function retryHeldImages(): void {
  const images = [...held];
  held.clear();
  for (const [image, wanted] of images) {
    if (!wanted()) continue;
    const src = image.src;
    if (src) image.src = src;
  }
}

/** Test hook: forget every held picture and listener. */
export function __resetHeldImages(): void {
  held.clear();
  listeners.clear();
}
