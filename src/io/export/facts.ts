// The export window's light facts, for callers that must not pull the compositor or the exporters
// into their bundle: the presets, sizes and options the controls offer, the footer vocabulary, the
// shorter history depth and the 3D card's cell shape.
export {
  EXPORT_PRESETS, RESOLUTION_KEYS, isImportable,
  type ExportOptions, type ExportPreset, type ResolutionKey,
} from './types';
export { CARD_3D_CELL_ASPECT, RESOLUTION_WIDTHS } from './compose';
export {
  DEFAULT_FOOTER, FOOTER_FILL, FOOTER_TOKENS, formatFooterDate, parseFooter,
  type FooterSeg, type FooterToken,
} from './footer-template';
export { DEFAULT_EXPORT_OPTIONS } from './options-store';

/** Undo steps the JSON export's shorter history choice keeps. */
export const RECENT_HISTORY_STEPS = 100;
