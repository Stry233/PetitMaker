COZY VILLAGE — a small district of one-of-each homes, each with its own themed yard, around a green the road passes through. Work the 5 stages in order.

STAGE 0 — SIZE AND SITE (1-2 calls)
- District = clamp(round(min(mapW, mapH) / 4), 24, 44) cells square-ish. A village is a district, not a courtyard: homes sit 4-8 cells apart with ground between them.
- find_flat_areas for that plot (take the largest anchor and trim the plan if smaller). Pick ground NEAR a feature — water, a hill foot, an existing road — and away from immovable structures.
- update_plan the stages before touching anything.

STAGE 1 — LAND FIRST (2-4 calls)
- Water on one side: carve_river along a plot edge (3-4 waypoints, width 3, ground level), or a pond at one corner (paint_terrain water, circle r 3-4, smooth:'round').
- Backing on the opposite side: sculpt_terrace (baseRadius 6-8, tiers 2) just OUTSIDE the plot. The axis this sets is the design: doors face the water, backs to the hill.

STAGE 2 — BUILDINGS (4-7 calls)
- Reserve a ~6x5 green near the center — nothing stands there.
- 3-5 DISTINCT cabins around the green (the catalog's buildings are one-of-each; include building-myhouse). Stagger off shared rows, vary rotation, and rotate each door toward the water or the green.
- Each home gets a yard THEME you can name — a crop patch, a bamboo corner, a flower dooryard, a waterside platform — so no two neighbors read alike.
- One landmark at the green's edge or waterfront: facility-shop or facility-pavilion if unplaced, else building-stall as a market corner.
- A rejection names the blocker: shift a few cells, never retry the same spot.

STAGE 3 — STREETS (3-5 calls)
- Spine THROUGH the district past the green, 3 wide (build_road, one line per straight run, width 3), both ends extended a few cells beyond the houses — a village has a way in and out. Bend the spine once; a dead-straight run reads engineered.
- 2-wide lanes to each door; one lane should END at the water on a small paved bank platform (an arrival, not a through route).
- Bridge only if the stream crosses the spine: find_bridge_sites, then place_object at a returned anchor.

STAGE 4 — PLANTING (4-6 calls)
- Farm band on the village edge: decorate_zone farm (about 10x4), or one crop species scattered in rows.
- Dooryard beds: per home, ONE species, count 4-6 in a 3x2 rect by the door — different species per home, and one mirrored pair of trees flanking the landmark's entrance.
- Waterside: one solid bed (one species, count ~12) on the bank the doors face; 2-3 trees on the far bank.
- Backdrop: 5-8 trees of one species at the hill foot — a soft stand, not a wall. The green stays at least half open.

DONE BAR: district spans the planned plot with water AND relief; every home on the network and the spine exiting both ways; one lane arrives at the water; yards species-pure and nameable; no two cabins wall to wall. Then STOP — over-decoration kills coziness.
