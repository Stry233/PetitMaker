COZY VILLAGE PLAYBOOK — work in 4 STAGES, in order.

STAGE 0 — SIZE & SITE (1-2 tool calls)
- SIZE THE DISTRICT FROM THE MAP (read width/height from map_context):
    plot = clamp(round(min(mapW, mapH) / 4), 24, 44) cells square-ish (e.g. 140-wide map → ~35x28).
  A village is a DISTRICT, not a courtyard — houses sit 4-8 cells apart with land between them.
- find_flat_areas with that plot size (it's fine if only smaller anchors exist — take the largest and trim the plan).
  Pick an anchor NEAR a feature (water/hill/existing road), away from IMMOVABLE structures in map_context.

STAGE 1 — LANDSCAPE FIRST (2-4 calls) — shape the land before any building:
- Water: carve_river (3-4 waypoints, width 3-4) along one edge of the plot, OR a pond: paint_terrain water circle r 3-4 smooth:'round' at one corner.
- Relief: sculpt_terrace (baseRadius 6-8, tiers 2) just OUTSIDE the plot on the side away from the water — the hill backdrop.
- These anchor the composition: houses will face water, backs to the hill.

STAGE 2 — BUILDINGS (4-7 calls)
- Central green: mentally reserve ~6x5 open grass near the plot center. Nothing is placed there except later dressing.
- 3-5 houses AROUND the green at 4-8 cell gaps, staggered off shared rows/columns (aligned = barracks). Max one repeated style; include building-myhouse if absent (max 1). Vary rotation (two at 0, others 90/270).
- One facility (pavilion/shop) at the waterfront or green edge — the landmark.
- Rejections name what's in the way — relocate a few cells, never brute-force the same spot.

STAGE 3 — CIRCULATION (3-5 calls)
- Road SPINE through the district passing beside the green; extend BOTH ends a few cells beyond the houses (a village has a way in and out). build_road road-dirt, line per straight run.
- Spurs: 1-3 cell spur per house front. A spur to the pond/pavilion too.
- Bridge only if the stream crosses the spine: find_bridge_sites → place_object at a returned anchor.

STAGE 4 — PLANTING (4-6 calls)
- Farm: a narrow band (e.g. 9x3) on the village edge, ONE crop species, scatter_objects count 12-16 — rows in a band read as cultivation.
- Garden beds: per house, ONE species count 3-4 in a 3x2 rect by the door; different species per house.
- Waterside: flowers count 6-8 along ONE pond/stream bank; 2-3 trees on the far bank.
- Backdrop: 5-8 trees of ONE species on the hill side (spacing 1) — soft edge, not a wall. Leave the green mostly OPEN (1 corner tree + a few flowers max).

QUALITY BAR before reporting done:
- district spans >= the planned plot (not a tiny cluster); has water AND relief, not just objects;
- every house on the road network; spine exits the district; green >= half empty;
- no two same-style houses adjacent; beds species-pure; >= 3 flora species total.
Then STOP — over-decoration kills coziness.