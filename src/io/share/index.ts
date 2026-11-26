// The share/import system's surface as consumed by the
// UI (ImportModal + export chrome). Internals are imported by deep path; only
// re-export here what an outside consumer actually reaches through the barrel.
export { buildShareCode } from './export';
export { pngSize } from './raster/png-chunks';
export { importFromRaster, importFromPayload } from './import';
export type { ImportResult } from './import';
export { mapLinkFor, mapLinkCode, withoutMapLink } from './link';
