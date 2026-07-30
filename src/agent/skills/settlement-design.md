SETTLEMENT DESIGN — any inhabited area; the craft of making a place feel lived-in.

WHEN TO USE: any time you are placing buildings and roads together, regardless of style
(cozy hamlet, farming village, mountain town, waterfront port).

PRINCIPLES
1. Hierarchy: every settlement has one heart (plaza, well, market, pavilion). Homes orbit
   it at varying distances; public buildings sit nearest.
2. Density gradient: tight near the heart, loose at the edges. The outermost buildings
   should feel like they are "drifting" away from the cluster.
3. Doors face roads: build_road_network after placement, OR lay roads first and place
   buildings along them. A building with no road adjacent reads as inaccessible.
4. Public vs private: front face = toward road or plaza; back face = toward garden/farm.
   Use decorate_zone garden or farm on the back side of building clusters.
5. Mixed scale: no two identical-style neighbors. Vary rotation (0 / 90 / 270), building
   type, and footprint. Maximum two instances of any one building style in adjacent cells.
6. Edges matter: transition from built area to wild terrain with hedges or flora drifts
   (scatter_objects trees or shrubs as a soft boundary) so buildings don't float in grass.

METHOD
1. Site: find_flat_areas with the planned settlement footprint. Identify the heart location
   (favor proximity to water or an existing plaza) and note the circulation entry point.
2. Heart first: place the landmark (facility-pavilion, well, or largest building) at the
   heart. This is the focal point — see the composition skill.
3. Orbiting buildings: place 3-6 homes in a loose ring 4-8 cells from the heart.
   Stagger — no two on the same row or column. Vary rotation.
4. Roads: build_road_network (or build_road for manual runs) connecting all building
   fronts to the heart and to the map's wider circulation. Extend the spine beyond the
   settlement so it reads as part of the world.
5. Back-side decoration: decorate_zone hamlet covers the bulk of the settlement interior;
   add decorate_zone garden or farm on back-side plots. Refine with scatter_objects for
   individual beds.
6. Edge softening: scatter_objects a loose tree/shrub band around the settlement perimeter.
   Leave the road approach open (no trees blocking the entrance view).

FAILURE MODES TO AVOID
- Grid barracks: houses in a perfect row with equal spacing. Stagger positions and vary
  rotations before placing — aligned rows read as a military camp.
- Doors to nowhere: place buildings after road layout or verify road adjacency after
  build_road_network; evaluate_map roads and connectivity will show orphaned buildings.
- Floating settlement: a cluster with no road connection to the wider map loses
  evaluate_map connectivity (must stay >= 8 for a well-connected map).
- Single-type hamlet: using only one building style throughout; mix at least 3 different
  building catalog IDs per settlement.

DONE CHECK
- evaluate_map connectivity >= 8 (settlement linked to map road network).
- evaluate_map buildings >= 6 (sufficient variety and count).
- Every building has a road within 2 cells of its front face.
- At least one decorate_zone garden or farm behind a building cluster.
