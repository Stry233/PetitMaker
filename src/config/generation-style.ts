/** The building-anchor regions of a designed planet: every placeable Building and Facility belongs to
 *  exactly one of these, through `GENERATION_STYLE.anchorRoles`. */
export type AnchorKind = 'residential' | 'own-house' | 'museum' | 'shop';

/** Catalog choices for procedural neighborhoods; array order participates in seeded generation. */
export const GENERATION_STYLE = {
  anchorRoles: [
    { id: 'building-bamboo-cabin', role: 'residential' },
    { id: 'building-boat-cabin', role: 'residential' },
    { id: 'building-fluorite-cabin', role: 'residential' },
    { id: 'building-forest-cabin', role: 'residential' },
    { id: 'building-plush-cabin', role: 'residential' },
    { id: 'building-starbay-cabin', role: 'residential' },
    { id: 'building-sunset-cabin', role: 'residential' },
    { id: 'building-wave-cabin', role: 'residential' },
    { id: 'building-stall', role: 'residential' },
    { id: 'building-myhouse', role: 'own-house' },
    { id: 'facility-pavilion', role: 'museum' },
    { id: 'facility-shop', role: 'shop' },
  ] satisfies readonly { id: string; role: AnchorKind }[],
  roads: {
    dominant: 'path-rustic-dirt',
    accents: ['path-garden-stone', 'path-lattice-red-brick', 'path-urban-asphalt'],
  },
  /**
   * Paved floors: a building or facility standing against the street network stands on the street's
   * own surface carried beneath its footprint, with probability `share`. One whose outline meets
   * pavement on less than `minFrontage` of its edge cells (a cottage reached by its doorstep, a house
   * set in a garden) keeps its ground.
   */
  pavedFloors: { share: 0.75, minFrontage: 0.2 },
} as const;
