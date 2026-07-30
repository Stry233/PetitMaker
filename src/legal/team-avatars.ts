/**
 * Team avatar asset map (Bilibili profile pictures, bundled + downscaled).
 *
 * A MAP rather than an inline URL in `LEGAL.team`: `config.ts` is pure launch
 * DATA — it must stay free of asset imports so it can be read/validated in any
 * context (the release validator, the static-page generator, tests) without
 * pulling the Vite asset graph. Each team entry therefore carries only its
 * Bilibili `avatar` MID (a stable string id); THIS module is the one place
 * that turns a MID into a hashed, bundled asset URL via a static `import`
 * (Vite fingerprints + emits the file, returns the served URL). The About
 * modal resolves `TEAM_AVATARS[member.avatar]` at render; an unmapped or
 * absent MID renders no image.
 *
 * Provenance: each file is a downscaled (128×128, center-cropped) copy of the
 * member's own Bilibili space avatar, used with per-member consent (consent
 * records are kept in the maintainers' internal repository).
 */
import a25599535 from '../assets/team/25599535.jpg';
import a3632319829116985 from '../assets/team/3632319829116985.jpg';
import a16699168 from '../assets/team/16699168.jpg';
import a3546659724200757 from '../assets/team/3546659724200757.jpg';

// Keyed by Bilibili MID (the numeric id in space.bilibili.com/<mid>), which is
// also the `avatar` field on each LEGAL.team entry.
export const TEAM_AVATARS: Record<string, string> = {
  '25599535': a25599535, // 镜喵MirrorCat
  '3632319829116985': a3632319829116985, // 鱼松吃点吗
  '16699168': a16699168, // 火山野牛王
  '3546659724200757': a3546659724200757, // Selka
};

/** Resolve a team member's bundled avatar URL from its MID, or undefined. */
export function teamAvatarUrl(mid: string | undefined): string | undefined {
  return mid ? TEAM_AVATARS[mid] : undefined;
}
