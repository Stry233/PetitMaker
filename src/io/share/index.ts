// src/io/share/index.ts — the share/import system's surface as consumed by the
// UI (ImportModal + export chrome). Internals are imported by deep path; only
// re-export here what an outside consumer actually reaches through the barrel.
export { buildShareCode } from './export';
export type { ShareCode } from './export';
export { importFromRaster, importFromBytes } from './import';
export type { ImportResult, ImportSuccess, ImportFailure } from './import';
export type { ShareErrorCode } from './errors';
export { mapNativePx, clampedCaptureRequestPx } from '../export/sizing';
export { moduleBaseFor } from './glyph/geometry';
