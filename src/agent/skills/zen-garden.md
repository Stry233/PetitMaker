ZEN GARDEN — restraint is the language: one specimen, pure hedges, a single stepping-stone path, and open ground held empty on purpose.

STAGE 0 — SIZE AND SITE (1-2 calls)
- Garden = clamp(round(min(mapW, mapH) / 5), 18, 32) cells square — intimate, every element read individually. find_flat_areas for it in a quiet corner away from roads and immovable structures. update_plan the stages.

STAGE 1 — THE ROOM (2-4 calls)
- Backdrop (optional): sculpt_terrace tiers=1, baseRadius ~garden/2, just outside ONE edge (north or east) — a gentle rise behind, never an enclosure on all sides. Skip if the map already gives the corner terrain.
- Hedges: ONE compact species (shrub or plant-gardenia), scattered dense (spacing 0) in two narrow 2-3 cell strips along two adjacent edges. Same species both strips — uniformity is the point. The other two sides stay open.
- The path: this is the one sanctioned 1-wide road — build_road path-garden-stone as a single line crossing the garden (one gentle bend at most). One path, no network; it should END inside the garden, at the viewing spot.

STAGE 2 — THE FOCUS (2-3 calls)
- One specimen tree (place_object, a distinctive species — tree-ginkgo, tree-plum, tree-dragonblood), off-center at roughly a third from one edge. It is the only individually placed tree; nothing competes.
- One quiet water figure (optional): a small clean-edged rectangle of ground-level water, about 7x3, near the path's end — still water, no ring of flowers.
- One local mirror at the entry: a matched pair (two stones of planting, two small trees of one species) flanking where the path enters — the garden's one symmetry.

STAGE 3 — THE GROUND (1-2 calls)
- decorate_zone garden over an inner rect (garden shrunk ~3 cells per side) for the beds — or, sparser, ONE solid single-species bed (5x6) beside the path. Open ground must stay the majority: if view_map reads dense, remove the last planting rather than balancing it with more.

STAGE 4 — SIGN-OFF
- view_map: specimen off-center, hedges framing two sides not boxing four, path visible and arriving, water still, MORE than half the interior empty.
- evaluate_map: low terrainInterest is fine here; judge this garden by the view, not the scores.
Quality bar: exactly one specimen, one path, one mirror, one water figure at most — and then STOP. Adding more is the one real mistake in this style.
