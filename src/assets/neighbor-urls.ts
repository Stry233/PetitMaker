/* Resolves a neighbour's portrait by its id through one Vite glob over src/assets/neighbors/, whose
 * files are named `<id>-icon.png`. */
const modules = import.meta.glob('./neighbors/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const PORTRAIT_URLS: Record<string, string> = {};
for (const path in modules) {
  PORTRAIT_URLS[path.split('/').pop()!.replace('-icon.png', '')] = modules[path]!;
}

export function neighborPortraitUrl(id: string): string | undefined {
  return PORTRAIT_URLS[id];
}
