/*
 * Build identity. Vite injects it exclusively from the committed `build-info.json` stamp;
 * `resolveVersion` derives the release line and adds `-dev` to unpublished builds. Packaged Lite
 * builds strip `-dev` before injection; local development keeps it. The `typeof` guards keep every
 * read working where Vite's `define` never ran, such as a bare unit-test import.
 */
import { IS_LITE } from './edition.ts';
import { UNSTAMPED_APP_VERSION } from '../../core/provenance/types';

const sourceVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : UNSTAMPED_APP_VERSION;
export const APP_VERSION: string = IS_LITE ? sourceVersion.replace(/(-dev)?$/, '-lite$1') : sourceVersion;
export const BUILD_NUMBER: string = typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : 'dev';
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
/** The copyright year: the stamped build date's year, or this year where no stamp is injected. */
export const BUILD_YEAR: number = Number(BUILD_DATE.slice(0, 4)) || new Date().getFullYear();

/**
 * Drives the dev-site notice and watermark. Web builds retain `-dev` until publication;
 * packaged Lite builds omit it, while local development retains it in both editions.
 */
export const IS_DEV_BUILD: boolean = APP_VERSION.endsWith('-dev');
