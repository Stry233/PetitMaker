/*
 * App + build metadata. Where the build identity comes from is described at the
 * BUILD block below; the `typeof` guards keep every read working in a context
 * where Vite's `define` never ran (e.g. a bare unit-test import).
 */

/**
 * Project name (working/temporary — the ONE place to rebrand).
 *
 * Change APP_NAME (and any per-locale override below) and the new name flows
 * everywhere automatically: it is injected as the `{app}` token into every UI
 * string via translateFor (see i18n/context) and into the agent system prompt
 * (see agent/system-prompt), and the browser tab title derives from it too. No
 * runtime string hardcodes the brand — they all write `{app}`.
 *
 * Only non-runtime, build-time surfaces still carry the literal (they can't read
 * this constant): index.html <title> and package.json "name" — plus descriptive
 * code comments. Grep those two files if you rebrand.
 */
export const APP_NAME = 'PetitMaker';

/** Per-locale display-name overrides; locales absent here render APP_NAME as-is. */
export const APP_NAME_OVERRIDES: Record<string, string> = {
  zh: '谷地工坊',
};

/** The brand name to display for a locale — the single resolver behind `{app}`. */
export function brandName(locale: string): string {
  return APP_NAME_OVERRIDES[locale] ?? APP_NAME;
}

/*
 * BUILD metadata, injected by Vite `define`. APP_VERSION is `MAJOR.MINOR.BUILD`, with
 * `-dev` unless this tree was published: PATCH is the build number, so the version carries
 * the same single source of truth as the stamp, and only the publish workflow can drop the
 * `-dev` (see `resolveVersion`). The build number, sha, and date are resolved by
 * `scripts/build-info-core.mts` from
 * the COMMITTED `build-info.json` stamp (then env, then git), so every copy of a
 * given source tree reports the same identity without needing the commit history.
 * The user-facing repository LINK is a separate concern and comes from
 * `LEGAL.repoUrl` (src/legal/config.ts).
 *
 * The fallbacks below only apply where the defines never ran (a bare unit-test
 * import). 'dev' rather than '0': an absent build number must not read like a real
 * one in a copied build line.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BUILD_NUMBER: string = typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : 'dev';
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';

/**
 * True when this build is NOT a published release: `resolveVersion` appends `-dev` unless a
 * release marker reached the stamp, and only the publish workflow writes one. So the dev site,
 * a local build, and anything built from a source checkout all report true, while a build of a
 * published snapshot reports false — with nothing to configure per environment.
 *
 * Drives the dev-site notice and watermark (ui/chrome/guards/DevBuildNotice).
 */
export const IS_DEV_BUILD: boolean = APP_VERSION.endsWith('-dev');
