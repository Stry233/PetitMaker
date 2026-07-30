ECOLOGY PLANTING — plant like nature works; applies to any style, any biome.

WHEN TO USE: any planting pass — after terrain and buildings are settled. Also as a
self-check when evaluate_map decoration is below 6 or view_map looks uniform/sparse.

PRINCIPLES
1. Drifts not confetti: clusters of one species with soft, overlapping edges. scatter_objects
   in offset overlapping patches, or plant_forest for larger stands.
2. Banding by elevation and moisture: waterside species (flowers, reeds) near water;
   conifers on high tiers; broadleaf trees on mid-elevation benches; scrub/grass at bases.
3. Ecotones: at boundaries between two bands, mix the neighboring species in a narrow
   transitional strip. The junction between forest and meadow is richer than either alone.
4. Clearings give forests shape: plant_forest leaves organic glades — do not fill them.
   An empty clearing inside a forest reads as intentional; a uniform tree wall reads as
   generated noise.
5. Thin toward inhabited areas: forest density should decrease as it approaches buildings
   and roads. A settlement ringed by solid forest looks fortified, not cozy.
6. Specimen trees as accents: one notable tree (large species, elevated position, edge of
   clearing) at a composition focal point ties the planting to the scene structure.

METHOD
1. Elevation bands: decide which species occupy each tier.
   Example: tier 0 = flowers/shrubs near water; tier 1 = broadleaf mix; tier 2+ = conifers.
2. Forest stands: plant_forest on mid/high tiers. Vary the scatter radius and species per
   call so stands have irregular shapes and sizes. Leave 10-20% of each tier unforested.
3. Waterside drifts: scatter_objects waterside species (flowers, reeds) in a band 1-3 cells
   from any water edge. Two separate scatter calls with slight offset produce the soft drift.
4. Ecotone strip: at the forest/meadow edge, one scatter_objects call mixing 2 species,
   lighter density than the main forest stand.
5. Settlement edges: scatter_objects 1-2 tree species in a loose ring around built areas
   (spacing 2-3); leave the road approach unplanted.
6. Specimen: one scatter_objects call, count 1, placing a large or distinctive species at
   the scene's focal point (hill top, pond edge, plaza entrance).

FAILURE MODES TO AVOID
- Uniform random sprinkle: a single scatter_objects over the entire map produces confetti.
  Cluster the calls into distinct bands and stands instead.
- Single-species walls: plant_forest with one species filling every cell up to a hard edge.
  Vary species, leave glades, use soft edges (lower density near boundaries).
- Planting over future road lines: roads need flat terrain. scatter_objects flora on a
  planned road path will block build_road_network. Place roads before planting, or leave
  clear corridors.
- Over-decorating: evaluate_map decoration plateaus above 8; adding more past that reduces
  negative space and hurts composition. Stop when decoration >= 7-8.

DONE CHECK
- evaluate_map decoration >= 6.
- At least 2 distinct elevation bands represented in the planting.
- Waterside species present near any water body.
- Forest stands have glades (not 100% filled).
- Settlement approach has a clear unplanted road corridor.
