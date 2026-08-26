/*
 * icon-urls.ts — resolves icon PNG basenames → URLs via a single Vite glob
 * over src/assets/icons/ (recursive: icons live in `catalog/` item sprites and
 * `ui/` chrome). Shared by the UI (menu/icons.tsx, the placement picker) and the
 * PixiJS renderer (object-layer sprites) so both pull from the one folder.
 * Lookup is by basename, so the subfolder layout is transparent to callers
 * (basenames are unique across folders).
 */
const modules = import.meta.glob('./icons/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Map of icon basename (e.g. "tree-apple") → resolved URL. */
const ICON_URLS: Record<string, string> = {};
for (const path in modules) {
  const name = path.split('/').pop()!.replace('.png', '');
  ICON_URLS[name] = modules[path]!;
}

export function iconUrl(name: string): string | undefined {
  return ICON_URLS[name];
}

/** Every icon URL the glob resolved — the boot splash preloads the lot. */
export function allIconUrls(): string[] {
  return Object.values(ICON_URLS);
}
