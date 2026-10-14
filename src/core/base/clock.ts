/** The host's wall clock in milliseconds since the epoch: core's one read of `Date`, for provenance
 *  operation times and session ids. Anything that must replay the same takes a clock as an argument. */
export function wallClock(): number {
  return Date.now();
}
