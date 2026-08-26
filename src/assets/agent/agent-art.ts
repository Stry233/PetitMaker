/**
 * agent-art.ts — resolves the one-character system's PNG art (the base drawing plus its two PNG
 * badges) to URLs via a Vite glob over the PNGs beside this file. Provenance: README.md in this
 * folder. Same glob pattern as `src/assets/cursors/cursor-art.ts` and `src/assets/icon-urls.ts`
 * (eager, `?url`, keyed by basename).
 *
 * The glob is EAGER, so a PNG in this folder ships whether anything reads it or not — unused art
 * must be deleted, not left beside the set.
 */
const modules = import.meta.glob('./*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const ART: Record<string, string> = {};
for (const path in modules) {
  const name = path.split('/').pop()!.replace('.png', '');
  ART[name] = modules[path]!;
}

/** The basenames this folder ships, one per file: the character body plus its two PNG badges
 *  (prototype `ART.base`/`ART.idea`/`ART.ask`, renamed here to their own file basenames since this
 *  folder holds nothing else). */
export type CharacterArtId = 'base' | 'badge-idea' | 'badge-ask';

export function characterArt(id: CharacterArtId): string {
  const url = ART[id];
  if (!url) throw new Error(`agent-art: missing PNG for "${id}"`);
  return url;
}
