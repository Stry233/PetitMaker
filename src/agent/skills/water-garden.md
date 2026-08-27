WATER GARDEN — the terraced water-court dialect from the expert island: a high backing wall to the north, formal pools sunk into terraces, courts whose water holds planted islets, crop plots in solid color blocks. The map's face is WATER shaped by built ground.

STAGE 0 — THE SECTION (1-2 calls)
- ONE sculpt_wall call with edge:"N" (depth 14-18, crest 8, flood:true) raises the backing wall AS the map's own boundary — never mid-field with grass behind it. This IS the primary form; build it FIRST. update_plan the stages.

STAGE 1 — THE WALL'S FACE (2-3 calls)
- The crest is a DESTINATION: the flood already sank its pool; pave a 2-wide run along it and put ramps on the south face (find_ramp_sites per level). For a signature, cut the crest pool as a FIGURE (figure-landscape has the lettering rules).
- plant_forest the wall's outer flanks only (density ~0.4); the crest and every court rim stay bare.

STAGE 2 — THE SET PIECE, while the budget is young (1-2 calls)
- One call, not optional, and EARLY — a run that saves its icon for last never builds it: draw_figure shape heart, size 14-18, islandFor a cabin id, ringId tree-peach on open low ground clear of the future terraces; then, IN THIS SAME STAGE, find_bridge_sites and place the one bridge — an island home nobody can reach is half the set piece. The heart is a SECONDARY: at the plaza's own width it rivals the primary, so larger only when the order names it THE feature.

STAGE 3 — TERRACES AND WATER COURTS (4-7 calls)
- FIRST RAISE THE TERRACES, and TWO benches, not one: a broad elevation-2 apron against the wall, then an elevation-1 apron south of it (paint_terrain rects, crisp edges), each retaining edge running wide with its OWN ramps (find_ramp_sites per level). "Terraced" is the class's name: the walk must visibly step down twice between crest and plaza, and one flat bench under a tall wall reads as a dry plain. The pools live IN this ground. Crop plots come LATER and BESIDE the courts, never in their place.
- 2-4 pool courts, EACH A DIFFERENT SHAPE, SIZE AND DRESSING — no two pools within 2 cells of the same width AND height, and each dressed differently (paved rim, islets, a planted edge) — and AT LEAST ONE stands BELOW the wall band, out in the town body: water that stops at the wall leaves a dry town under a decorated rampart. One sink_pool call per court lays the bench rim and the contained water together (composing it by hand is the revert loop).
- THE ISLET GRID, once: sink_pool with islets:true on the LARGEST pool, then scatter_objects pattern "grid" step 3 with ONE species over its rect — the planted parterre. At least 3x3 islets: a 2x2 token does not read as a lattice, so size the pool to hold the grid.
- One waterfall where a pool meets the terrace edge: 1-3 framed lip cells, uniform landing (pro-terraforming has the recipe), with a downstream pool or carve_river run.

STAGE 4 — THE CROP PLOTS (2-3 calls)
- Keep 3-4 cells of lawn against the plaza's faces (the primary breathes). The low ground carries 4-8 rectangular plots (~6x8), separated by 1-wide paved lines a walker can enter (the lines join a street at both ends), each plot ONE species solid (scatter_objects pattern "fill") in a different color — dye fields. Beside them, one orchard grid of a single tree species (tree-peach is the island's own).

STAGE 5 — HOMES AND THE WALK (4-6 calls)
- Homes one per terrace pocket, backed by wall or rim, door toward water — never flush against the plaza wall (the primary keeps its apron). EVERY home gets a composed yard: a flower ribbon or hedge run along at least two sides, or a small paved dooryard joining its path — a bare cabin on open lawn is a defect (the island home is the one exception; its water IS the yard).
- The zones are WALKED BETWEEN, not laid side by side: every adjacent pair (wall/pools, pools/plots, plots/orchard, plaza/pond court) is joined by at least one paved link, and ramps RECUR — 2-4 across the map at alternating faces, never one lone column. 2-wide streets along each terrace, bridges where streets cross water; the trunk passes plaza, facility-shop and facility-station on the low ground.

THE GROUND YOU DO NOT COMPOSE STAYS EMPTY — everywhere, not just the south: after the set pieces, STOP. A mixed green-and-pink sprinkle laid to "finish" leftover grass is the one move that always reads machine; a specimen cluster is ONE species. The low south is the garden's front lawn: give it a single framing gesture near the margin (a path stub, a short orchard row, or one specimen tree) so the emptiness reads held, then leave it — plant_forest never touches it.

DONE BAR: wall abuts the far edge, crest paved, flooded and REACHED by ramps; 2-4 distinct water courts with ONE islet parterre; crop plots in solid colors with enterable lanes; one fall with a downstream; the island home behind its bridge; the route climbs plaza to crest. Then find_speckle and clear or replant every patch it names — no loose speckle stands anywhere.
