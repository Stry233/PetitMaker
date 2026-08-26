ALPINE CASCADE — a summit massif with a crown pool feeding chained falls, a switchback ascent, and a paved summit court. The peak must be a DESTINATION the walk reaches, not a backdrop. Work the 5 stages in order.

STAGE 0 — SIZE AND SITE (1-2 calls)
- Massif = clamp(round(min(mapW, mapH) / 3), 28, 52) cells across; center at least massif/2 + 4 cells from every map edge, offset from the map centroid so it sits asymmetrically. update_plan the stages, then find_flat_areas for the footprint.

STAGE 1 — THE MOUNTAIN (2-4 calls)
- sculpt_terrace cx,cy baseRadius=<min(massif/2, 12)> tiers=3 — one call, three organic tiers. For a taller peak on a big map, add paint_terrain mountain elevation 4-5 (smooth:'round') on a crown region inset 2+ cells inside the tier-3 blob; a sheer face may drop at most 3 layers, so keep each higher band inset.
- One foothill (sculpt_terrace baseRadius 4-5, tiers 1, another seed) attached at the base so the mass lands in the plain.
- Call your top elevation S. Keep the summit bench broad and flat — the court and pool need it.

STAGE 2 — WATER (2-4 calls)
- Crown pool: paint_terrain water elevation=S on INTERIOR summit cells, keeping a >= 1-cell ring of mountain at exactly S (the contained-pond recipe).
- Falls, one lip per tier: paint_terrain water at THAT tier's elevation on 1-3 lip cells at the cliff edge, mountain at exactly that elevation on both perpendicular sides, the tier below already the uniform landing. Never carve or paint water flowing down a slope — that always REVERTS. Offset each tier's lip sideways from the one above and vary their widths: a chain of distinct falls, not a stack of twins.
- At the foot: a plunge pool (ground-level water circle) or carve_river from the landing to the sea — the cascade needs a downstream.

STAGE 3 — THE ASCENT (2-4 calls)
- find_ramp_sites per tier transition (every ramp climbs exactly one layer). Pick anchors on ALTERNATING faces — south, then east, then north — a switchback, never a ladder; mix ramp styles.
- Pave the route: a 2-wide build_road lane from the map's network to the foot ramp, and a short paved run across each bench between ramps. The climb itself is the attraction.

STAGE 4 — SLOPES AND SUMMIT (2-3 calls)
- plant_forest over the lower and mid slopes (density ~0.5), leaving the ascent's faces and the summit clear — a treeless peak reads alpine, and the view must open as the path rises.
- Summit court: decorate_zone peak over the top-tier interior beside the pool (shrink the rect 2 cells per side if it would overlap the water).
- evaluate_map; fix any regression, then view_map: the fall line should read as a broken diagonal down the massif.

DONE BAR: pool enclosed and every lip standing (no REVERTED); the paved route climbs from the plain to the summit court via alternating ramps; falls differ in width and offset; forest frames the base, the peak stays bare. Then STOP — over-sculpting turns a peak into noise.
