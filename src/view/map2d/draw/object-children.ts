/**
 * The names an object wrapper's tagged children carry, so the parts that look for them (the
 * rotation tweens, the layer-number toggle) find the child the object layer and the ramp art made.
 */
export const OBJECT_CHILD = {
  /** The turning art of a rotatable or footprint-turning item, which a rotation spins. */
  icon: '_icon',
  /** A layer number drawn on the object, shown and hidden with the layer numbers. */
  elevation: '_elev',
} as const;

/** The child among `children` tagged `name`, if one is. */
export function taggedChild<T extends { name: string | null }>(children: readonly T[], name: string): T | undefined {
  return children.find((c) => c.name === name);
}
