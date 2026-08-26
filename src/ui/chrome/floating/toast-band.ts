/**
 * The band the ordinary toasts stack in: where it starts, and how much room one toast takes with
 * the air under it, in css px.
 *
 * Its own module rather than a pair of exports on `Toast.tsx`, because the other reader is the
 * ARRIVAL notice, which stands clear of this band so a refusal is never lost under a greeting — and
 * a surface that reached into the toast component for two numbers would be importing a whole live
 * region to find out where it may stand.
 *
 * The row is `Toast.tsx`'s own metrics: 11px of padding either side of a 21px line, plus the
 * container's 8px gap between one toast and the next.
 */
export const TOAST_BAND_TOP = 64;
export const TOAST_BAND_ROW = 51;

/** The arrival greeting's own row: its card is 72 tall (48px of planet art with 12px of padding
 *  above and below it) and this keeps 12 of air under that. The dev-build notice stands below this,
 *  so the band's three tenants (refusals, the greeting, the notice) are stacked here by declaration
 *  rather than by luck. Every one of them is placed INSIDE the chrome zoom, so the sums here are in
 *  one space and the stack holds at every scale. */
export const ARRIVAL_ROW = 84;
