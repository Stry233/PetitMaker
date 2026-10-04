/*
 * App + build metadata. Where the build identity comes from is described at the
 * BUILD block below; the `typeof` guards keep every read working in a context
 * where Vite's `define` never ran (e.g. a bare unit-test import).
 */

/**
 * Project name (working/temporary — the ONE place to rebrand).
 *
 * Change BASE_APP_NAME (and any per-locale name below) and the new name flows
 * everywhere automatically: it is injected as the `{app}` token into every UI
 * string via translateFor (see i18n/context) and into the agent system prompt
 * (see agent/system-prompt). Runtime copy uses `{app}`.
 *
 * Deployment titles and descriptions in legal/deploy-targets.ts, the index.html
 * fallback title, and package.json also carry the name and need review when rebranding.
 */
import { IS_LITE } from './core/runtime/edition';

export const BASE_APP_NAME = 'PetitMaker';

/** Per-locale names without the edition badge; locales absent here use BASE_APP_NAME. */
const LOCALE_BASE_NAMES: Record<string, string> = {
  zh: '谷地工坊',
};

/** The wordmark's name; edition badges are rendered separately. */
export function baseBrandName(locale: string): string {
  return LOCALE_BASE_NAMES[locale] ?? BASE_APP_NAME;
}

/** The brand name to display for a locale, edition included: the single resolver behind `{app}`. */
export function brandName(locale: string): string {
  const base = baseBrandName(locale);
  return IS_LITE ? `${base} (Lite)` : base;
}

export const APP_NAME = brandName('en');

/*
 * Vite injects build identity exclusively from the committed `build-info.json` stamp.
 * `resolveVersion` derives the release line and adds `-dev` to unpublished builds.
 * Packaged Lite builds strip `-dev` before injection; local development keeps it.
 * These fallbacks apply only when Vite's defines are absent, such as bare unit-test imports.
 */
const sourceVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const APP_VERSION: string = IS_LITE ? sourceVersion.replace(/(-dev)?$/, '-lite$1') : sourceVersion;
export const BUILD_NUMBER: string = typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : 'dev';
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';

/**
 * Drives the dev-site notice and watermark. Web builds retain `-dev` until publication;
 * packaged Lite builds omit it, while local development retains it in both editions.
 */
export const IS_DEV_BUILD: boolean = APP_VERSION.endsWith('-dev');
