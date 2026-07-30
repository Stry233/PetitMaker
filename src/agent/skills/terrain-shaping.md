TERRAIN SHAPING — landform first, any style; the craft of building ground before detail.

WHEN TO USE: any time terrain is the main objective, before decorating. Also as a
self-check when evaluate_map terrainInterest is below 6.

PRINCIPLES
- Macro silhouette before micro detail: establish the overall ridge/valley shape with
  big tools before smoothing or trimming any edges.
- Tier rhythm: bench widths should vary; a uniform staircase reads as artificial.
  sculpt_terrace tiers max 3; higher elevation via manual paint_terrain respects V-MTN-03
  (layers 1-3 need no inset; for elevation 4+ each step up must sit one cell inside the mass below — V-MTN-03 needs a full 3x3 of support at elevation >= N-3, so a single wide bench legally carries up to 3 layers above it).
- Edge treatment: smooth/round coasts and outer cliff faces; keep inner working edges
  (cliff lips adjacent to paths, pond rims) crisp.
- Drainage logic: water starts high and contained, steps down via waterfalls.
  Interior ponds sit within a mountain ring. Rivers follow the natural lowland seams.
  Never paint water uphill of its containment ring (V-WTR-02 auto-reverts it).
- Leave flat usable benches: every terraced level needs enough flat interior for at least
  a ramp landing and a decorating pass later.

METHOD
1. Establish silhouette: sculpt_terrace for the primary ridge/hill (use varied seeds per
   call to avoid identical blob shapes). Place 2-3 overlapping calls to form a ridge.
2. Carve water: carve_river for any rivers (3-5 waypoints, width 3-4, meander 4-8 cells
   laterally). Interior ponds via paint_terrain water inside a completed mountain ring.
3. Shape foothills and coasts: additional sculpt_terrace calls at lower tiers, smaller
   radius; paint_terrain with smooth:'round' for custom inlets or peninsulas.
4. Check with view_map: scan for wedding-cake concentrics, flat plateaus > half the map,
   or water painted without a containment ring.
5. Edge detail: trim cliffs with the edge-cut system where straight walls need rounding;
   apply erase_terrain to bite coves from straight coasts.
6. Ramp access: call find_ramp_sites for each tier. Place ramps before decorating
   so you know which cliff faces are "used" and shouldn't be smoothed away.

FAILURE MODES TO AVOID
- Pancake maps: a single flat elevation with objects on top. Minimum 2 visible tiers
  before decorating; evaluate_map terrainInterest will flag this.
- Wedding-cake concentric circles: three perfect rings of decreasing radius look
  engineered. Use sculpt_terrace with different centers and overlapping blobs instead.
- Water painted uphill or without ring: always complete the containing mountain ring in
  the same call or before painting water. Post-stroke validation reverts illegal water.
- Sealing the only connector: if a flat seam is the only walkable path between two
  regions, raising it severs connectivity (evaluate_map connectivity will drop).
  Confirm find_ramp_sites returns a valid crossing before raising.

DONE CHECK
- evaluate_map terrainInterest >= 6.
- Every elevated area reachable via find_ramp_sites results.
- No isolated grass regions (evaluate_map connectivity >= 8).
- Water is enclosed (no REVERTED errors on water calls).
