TERRAIN SHAPING — the land is the design; objects only dress it. The expert reference island is 60% mountain and 26% water, terraced almost everywhere, and still reads calm — because the terracing follows a plan.

WHEN TO USE: whenever terrain is the objective, before decorating; also when evaluate_map terrainInterest or silhouette is weak.

THE PLAN OF THE LAND
- ONE gradient axis: pick a back side and grade the whole map near-low-far-high. The expert island's mean elevation runs 7 / 3.5 / 1.5 / 1.4 across its four quarters — a backing wall 30-40 rows deep along the far edge, working platforms at 1-3 in the middle, open ground in front. High mass scattered among low places blocks views from behind and beside at once; massed on one side it orients the whole map.
- TERRACES ARE FLOORS, not scenery: leave every bench flat enough to pave and decorate later (benches of 6+ cells deep are floors; 2-3 cell ledges are just cliff texture). Elevation the walk cannot reach is wasted.
- Big forms, few of them: one coherent massif beats the same area broken into ten blobs. Keep foothills attached to the main mass.

TOOL MOVES
- Hills up to 3 tiers: sculpt_terrace (baseRadius 3-12, tiers 1-3, organic rounded cliffs). Overlap 2-3 calls with different centers and seeds for a ridge; never concentric circles from one center (wedding cake).
- Taller than 3: paint_terrain mountain with the FINAL elevation (it auto-builds support tiers; max elevation 8, max 4000 cells per call — split big bands). Legality: mountain at elevation 4+ needs a full 3x3 of neighbors at elevation >= N-3 (V-MTN-03), so a sheer face can drop at most 3 layers — step taller forms, each band inset 1+ cells inside the band 3 below it. Width before height.
- Edges: smooth:'round' on every organic paint; keep working edges crisp (pond rims, cliff lips a ramp will use). erase_terrain bites coves out of straight coasts; trim_corner for single stubborn corners.

WATER IS A VOCABULARY, NOT A STAMP
- Give each body a different job and shape: one meandering river (carve_river, 3-5 waypoints, ground level only, width 3-6 — vary width across segments by chaining two calls at a shared waypoint), one pond cut INTO a terrace, one fall, maybe a formal figure by a paved place. Never repeat one pond shape more than twice; a lattice of identical squares reads as wallpaper.
- Pond in a terrace (the expert habit): a rectangle (12x4, 9x3, 7x7) sunk into a bench — build the bench at elevation N, then paint_terrain water elevation N on interior cells keeping a >= 1-cell ring of the bench's own mountain at exactly N (V-WTR-02 is satisfied by the ring). The terrace edge is the frame; no flower ring needed.
- Waterfall: ONE lip, not drawn falling water. The lip is 1-3 water cells at elevation N framed by mountain at exactly N on both perpendicular sides, with the row directly in front already ONE uniform lower elevation (V-WTR-03). The game animates the fall. Give a fall a downstream: a pool or river below it.
- Cascade set piece: stacked water bands, one per bench, 2-4 rows deep, stepping down 6-5-4-3-2-1-0 with 1-3 rows of mountain between — a whole slope becomes a water story.

ACCESS AS YOU GO
- Every catalog ramp climbs exactly ONE layer, so a climb of N layers is N benches with N ramps. find_ramp_sites after each tier lands; place ramps on alternating faces so the route switchbacks. A terraced map wants roughly ten ramps per bridge.

FAILURE MODES
- Pancake (one flat level) and wedding cake (concentric rings) — both are the absence of a plan.
- Water uphill or unringed: complete the containing ring in the same call or the whole call REVERTS.
- Sealing the only connector between two areas: confirm a ramp or bridge site exists before raising a wall across a seam.

DONE CHECK: evaluate_map terrainInterest and silhouette >= 6, every bench reachable (find_ramp_sites has answers), one dominant form visible from the low ground, no two water bodies congruent.
