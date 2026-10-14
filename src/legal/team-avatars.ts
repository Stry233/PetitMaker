/**
 * Team avatar asset map (Bilibili profile pictures, bundled + downscaled).
 *
 * A map rather than an inline URL in `LEGAL.team`: `config.ts` is pure launch
 * Data — it must stay free of asset imports so it can be read/validated in any
 * context (the release validator, the static-page generator, tests) without
 * pulling the Vite asset graph. Each team entry therefore carries only its
 * Bilibili mid (a stable string id); this module is the one place
 * that turns a mid into a hashed, bundled asset URL: every file under
 * `assets/team/` is imported eagerly, named by its mid (Vite fingerprints and
 * emits each file and returns the served URL). The About
 * modal resolves `TEAM_AVATARS[member.bilibili]` at render; an unmapped or
 * absent mid renders no image.
 *
 * Provenance: each file is a downscaled (128×128, center-cropped) copy of the
 * person's own Bilibili space avatar, used with per-person consent (consent
 * records are kept in the maintainers' internal repository). The map covers
 * both `LEGAL.team` and `LEGAL.acknowledgements`.
 */
const avatarFiles = import.meta.glob('../assets/team/*.jpg', { eager: true, import: 'default' }) as Record<string, string>;

// Keyed by Bilibili mid (the numeric id in space.bilibili.com/<mid>), which is each file's basename
// and the `bilibili` field on each credited member; config.ts owns the names.
export const TEAM_AVATARS: Record<string, string> = Object.fromEntries(
  Object.entries(avatarFiles).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.jpg'.length), url]),
);

/** Resolve a team member's bundled avatar URL from its mid, or undefined. */
export function teamAvatarUrl(mid: string | undefined): string | undefined {
  return mid ? TEAM_AVATARS[mid] : undefined;
}
