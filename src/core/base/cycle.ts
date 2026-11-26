/** Stepping through a group of options that wraps round at either end. */

/** Which way a cycle steps through its options: 1 forward, -1 back. */
export type CycleStep = 1 | -1;

/** The option `step` places after `current` in `options`, wrapping round at either end; from a value
 *  `options` lacks, forward lands on the first and back on the last. An empty group keeps `current`. */
export function stepIn<T>(options: readonly T[], current: T, step: CycleStep): T {
  if (options.length === 0) return current;
  const at = options.indexOf(current);
  const from = at < 0 ? (step > 0 ? -1 : options.length) : at;
  return options[(from + step + options.length) % options.length]!;
}
