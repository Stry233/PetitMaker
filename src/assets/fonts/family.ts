/** The shipped CJK design face and the Latin accent face, as `fonts.css` declares them. */
export const CJK_FACE = 'Alibaba PuHuiTi 3';
export const LATIN_FACE = 'PW Rounded Sans';

/** The family interface text is set in: first in the stack and covering every script the interface
 *  shows, so the editor's text requests its weights and never the accent face's. */
export const INTERFACE_FACE = CJK_FACE;

/** The stack's tail: faces the device already has, which show before any shipped file loads. */
export const DEVICE_FONT_FAMILY = `'Varela Round', system-ui, sans-serif`;

/** Shared font stack for interface text and labels painted into either map view. */
export const APP_FONT_FAMILY = `'${INTERFACE_FACE}', '${LATIN_FACE}', ${DEVICE_FONT_FAMILY}`;
