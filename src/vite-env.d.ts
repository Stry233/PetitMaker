/// <reference types="vite/client" />

// Build metadata injected by Vite's `define` (see vite.config.ts).
declare const __PETIT_LITE__: boolean;
declare const __APP_VERSION__: string;
declare const __BUILD_NUMBER__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;
declare const __PETIT_EXPORT_SITE_MARK__: boolean;
/** The deployment target id; read only through `platform/build/target.ts`. */
declare const __PETIT_TARGET__: string | undefined;
/** The map check's asset folder under the site root, content-hashed in web builds. */
declare const __PETIT_MODERATION_DIR__: string | undefined;
/** Base64 JSON of each module worker's output files in web builds; empty elsewhere. */
declare const __PETIT_WORKER_FILES__: string | undefined;
