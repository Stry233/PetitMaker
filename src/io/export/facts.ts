// The export window's light facts, for callers that must not pull the compositor or the exporters
// into their bundle: the presets, sizes and options the controls offer, the footer vocabulary, the
// shorter history depth, the 3D card's cell shape and the ratio a picture of a map has.
export {
  EXPORT_PRESETS, RESOLUTION_KEYS, isImportable,
  type ExportOptions, type PictureChoices, type ResolutionKey,
} from './types';
export { CARD_3D_CELL_ASPECT, FALLBACK_MAP_ASPECT, RESOLUTION_WIDTHS } from './compose';
export { mapPictureAspect } from './sizing';
export { hasProvenanceBadge } from './render';
export {
  DEFAULT_FOOTER, FOOTER_FILL, FOOTER_TOKENS, footerTemplateOf, formatFooterDate, parseFooter, type FooterSeg,
} from './footer-template';
export { DEFAULT_EXPORT_OPTIONS } from './options-store';

/** Undo steps the JSON export's shorter history choice keeps. */
export const RECENT_HISTORY_STEPS = 100;
