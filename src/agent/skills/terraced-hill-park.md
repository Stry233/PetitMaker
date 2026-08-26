TERRACED HILL PARK — a scenic hill whose path CLIMBS it: benches you can walk, a lookout court on top, an elevated pond on the way up.

STAGE 0 — SIZE AND SITE (1-2 calls)
- Hill = clamp(round(min(mapW, mapH) / 4), 18, 36) cells across. find_flat_areas for that footprint, away from immovable structures but within reach of the existing road network — a park nobody can walk to is scenery.

STAGE 1 — THE HILL (1-3 calls)
- sculpt_terrace (baseRadius = hill/2 up to 12, tiers 2-3, smooth 'round', any seed) — organic blob tiers, never concentric circles. Offset the center from the plot centroid so the hill sits asymmetrically.
- Each bench must stay a FLOOR: if a tier came out under ~4 cells deep anywhere the path will go, widen it with paint_terrain mountain at that tier's elevation (smooth:'round').

STAGE 2 — THE CLIMB (3-5 calls)
- find_ramp_sites, then place_object one ramp per tier transition at returned anchors — every ramp climbs exactly one layer. Put successive ramps on DIFFERENT faces so the route switchbacks around the hill instead of laddering straight up.
- Pave the route: a 2-wide build_road lane from the nearest road to the foot ramp, and a short paved run across each bench between its ramps. The climb is the park.

STAGE 3 — THE REWARDS (2-4 calls)
- Lookout: on the top bench, decorate_zone peak over the summit interior — or facility-pavilion if it fits (needs about 7x6 flat; check find_flat_areas elevation=<top>) with its front facing the open view, back to nothing.
- Elevated pond on a mid bench: paint_terrain water at that bench's elevation on interior cells, keeping a >= 1-cell ring of the bench's own mountain (a sunk rectangle, 7x3 to 9x4, reads better than a blob).
- The pond's viewing side faces the path; leave its far side plain terrace.

STAGE 4 — DRESSING (2-3 calls)
- One solid flower bed (one species, ~5x6) at the hill foot on the approach side; one specimen tree at the summit court's edge.
- A loose stand of one tree species on the back slope (scatter_objects, spacing 1) — the face the path climbs stays open so the view keeps opening as you rise.

DONE BAR: every bench reachable by ramps with the lane arriving at the foot; the top holds a court or pavilion looking over open ground; pond enclosed (no REVERTED); the front slope open, the back planted. evaluate_map terrainInterest >= 6, then stop.
