/** The buildable region's opacity factor at progress `t` (0 to 1) of a refusal pulse: full at both
 *  ends and lowest, `1 - dip`, halfway through. */
export function regionPulseFactor(t: number, dip: number): number {
  return 1 - dip * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
}
