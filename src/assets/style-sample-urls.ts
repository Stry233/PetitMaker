/*
 * Resolves an illustration direction's committed sample and swatch by basename through one Vite
 * glob over src/assets/stylize/*.webp, as icon-urls.ts resolves icons. A provider direction's
 * sample comes from the tuning rig and a local pack's is baked from the showcase map, so no
 * thumbnail is rendered at run time. Both resolvers answer null until the file exists.
 */
const modules = import.meta.glob('./stylize/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const URLS: Record<string, string> = {};
for (const path in modules) {
  const name = path.split('/').pop()!.replace('.webp', '');
  URLS[name] = modules[path]!;
}

/** The samples' own ratio, in capture px of the built-in planet they picture. */
export const STYLE_SAMPLE_ASPECT = 10848 / 8992;

/** The pack's full illustrated sample (`<id>.webp`), or null until it exists. */
export function packSampleUrl(id: string): string | null {
  return URLS[id] ?? null;
}

/** The pack's cropped style-swatch condition image (`<id>-swatch.webp`), or null until it exists. */
export function packSwatchUrl(id: string): string | null {
  return URLS[`${id}-swatch`] ?? null;
}

/** Every committed sample and swatch, for the warm schedule's prefetch. */
export function allStyleSampleUrls(): string[] {
  return Object.values(URLS);
}
