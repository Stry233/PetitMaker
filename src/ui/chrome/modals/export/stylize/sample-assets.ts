// Resolves a style's committed sample/swatch art through a Vite glob barrel over
// src/assets/stylize/*.webp — the same pattern src/assets/icon-urls.ts resolves catalog icons by
// basename. Model directions' samples come from the dev-time tuning rig; the drawn-here packs'
// samples are baked from the showcase map by the preview page's emit mode (the rig named in
// the project's internal tooling notes), so no thumbnail is ever rendered at run time. Both
// resolvers return null until the asset exists; every consumer falls back to a palette-painted
// thumbnail.
const modules = import.meta.glob('../../../../../assets/stylize/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const URLS: Record<string, string> = {};
for (const path in modules) {
  const name = path.split('/').pop()!.replace('.webp', '');
  URLS[name] = modules[path]!;
}

/** The pack's full illustrated sample (`<id>.webp`), or null until it exists. */
export function packSampleUrl(id: string): string | null {
  return URLS[id] ?? null;
}

/** The pack's cropped style-swatch condition image (`<id>-swatch.webp`), or null until it exists. */
export function packSwatchUrl(id: string): string | null {
  return URLS[`${id}-swatch`] ?? null;
}
