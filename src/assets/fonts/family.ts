/** The shipped CJK design face and the Latin accent face, as `fonts.css` declares them. */
export const CJK_FACE = 'Alibaba PuHuiTi 3';
export const LATIN_FACE = 'PW Rounded Sans';

/** Every shipped family with the weights `fonts.css` declares for it. */
export const FONT_FACES: readonly { family: string; weights: readonly number[] }[] = [
  { family: CJK_FACE, weights: [400, 500, 700, 900] },
  { family: LATIN_FACE, weights: [500, 700] },
];

/** Shared font stack for interface text and labels painted into either map view. */
export const APP_FONT_FAMILY = `'${CJK_FACE}', '${LATIN_FACE}', 'Varela Round', system-ui, sans-serif`;
