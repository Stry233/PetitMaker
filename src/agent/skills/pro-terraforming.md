PRO TERRAFORMING — the advanced terrain moves: tall walls, cascades, elevated water, and the exact patterns that pass validation first try.

Adapt this reference to the requested area, features and scale. Its examples are optional; keep existing work and explicit constraints. Choose the relevant techniques, not the entire layout.

WHEN TO USE: any serious landscaping beyond a 3-tier hill — backing walls, waterfall chains, elevated pools, coastline work.

TALL FORMS (above sculpt_terrace's 3-tier cap)
- paint_terrain mountain takes the FINAL elevation (up to the ceiling its schema gives) and auto-builds the support tiers. The one legality is V-MTN-03 (its rule hint gives the thresholds): a tall cell needs a full support window within the rule's reach below it, so a sheer face can drop at most that reach. Build tall forms as stacked bands, each higher band inset 1+ cells inside the band one reach below it, each call under 4000 cells.
- THE BACKING WALL (the expert planet's primary form): a band 30-40 rows deep along ONE map edge, graded in 2-3 paint_terrain bands (e.g. a base band one support reach up, an inset band one reach higher, the crown at the elevation ceiling) with smooth:'round'. Keep the crown FLAT and broad — the reference paves and even floods its top; a wall you cannot stand on is scenery, a wall with a court on top is a destination.
- Foothills: 1-2 sculpt_terrace calls (tiers 1-2, varied seeds) where the wall meets the plain, so the mass lands rather than stopping.

ELEVATED WATER (the containment recipes)
- Pool on a bench: bench at elevation N, then paint_terrain water elevation N on INTERIOR cells with a >= 1-cell ring of the bench's own mountain at exactly N (V-WTR-02 by construction). Expert pools are rectangles sunk into the terrace — 12x4, 9x3, 7x7 — framed by the terrace edge itself, no planting ring.
- WATERFALL: never draw water flowing down — the fall is ONE row of 1-3 lip cells and the game animates it. Sequence: (a) high ground at elevation N; (b) LANDING FIRST — the row directly in front of the drop already ONE uniform lower elevation across the fall's width; (c) contained pool at N behind the lip; (d) paint_terrain water elevation N on the 1-3 lip cells, mountain at exactly N on both perpendicular sides. If it REVERTS, the landing row or the side frame is uneven — square that strip with paint_terrain (no smooth) and retry once.
- CASCADE (the show piece): one water band per bench, 2-4 rows deep and 20-40 wide, stepping 6-5-4-3-2-1-0 with 1-3 rows of mountain between bands. Build ALL benches first (a staircase of 1-layer steps is always legal), then flood top-down, each band ringed by its own bench with a framed lip toward the band below; if a band REVERTS, keep it fully ringed and narrow its fall to a few framed lip cells. Multiple falls should differ — a wide main drop plus a narrower offset one, never twins.
- Give every fall a downstream: a plunge pool, a river reaching the sea, or the next band down. carve_river runs downhill and frames its own waterfall where its course crosses a terrace step, so one call can carry a river from a band to the ground below.

RIVERS AND COASTS
- carve_river through 3-5 waypoints with 4-8 cell sideways offsets; chain two calls at a shared waypoint to change width mid-course (narrow 3 past the houses, widen to 5 into a bay or the mouth). One river with varied parts beats three identical streams.
- Lake as a widening: a paint_terrain water circle (smooth:'round') overlapping one river bend.
- Coasts: alternate erase_terrain bites and small mountain blobs (r 2-3) along a straight shoreline; a straight coast longer than ~10 cells is unfinished.

WORKFLOW
- Large to small: wall, then river, then benches and pools, then coast detail. Check each result snapshot and fix as you go.
- Ramps as you build: check each ramp’s catalog heightDrop and use find_ramp_sites for the intended transition — cliff faces a route will use should stay unsmoothed.
- Decorate only after all terrain: waterside beds, orchard benches, high tiers mostly bare.
