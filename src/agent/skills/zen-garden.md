ZEN GARDEN PLAYBOOK — restraint is the design language. Fewer, more deliberate placements. Work in 4 STAGES, in order.

STAGE 0 — SIZE & SITE (1-2 tool calls)
- SIZE FROM THE MAP: garden = clamp(round(min(mapW, mapH) / 5), 18, 32) cells square.
  A zen garden is intimate, not a park — keep it small enough that every element reads individually.
- update_plan: record the four stages and the enclosure corners before starting.
- find_flat_areas minWidth=<garden> minHeight=<garden> — pick a quiet corner away from roads and immovable structures.

STAGE 1 — ENCLOSURE & GROUND (2-4 tool calls) — define the room first
- Low rim (optional): sculpt_terrace cx=<garden_cx> cy=<garden_cy> baseRadius=<garden/2 + 2> tiers=1 seed=<any>
  used as a subtle BACKDROP hill on one side only (north or east). Keep it gentle — baseRadius large relative to tiers so the cliff is only 1 elevation unit. Skip this if the map already has terrain context.
- Raked path texture: build_road road-dirt as a STRAIGHT line across the garden (one diagonal or axial run).
  Zen gardens have a single implied path, not a network — one run only.
- Hedge rows: scatter_objects with 1 tree species (use a compact shrub-style tree) count=<garden/2> in two narrow rects flanking the path: one rect along the garden's north edge, one along the east edge (3 cells wide, full garden length). This creates enclosure without a wall.
  Use the SAME species for both hedges — uniformity is a zen principle.

STAGE 2 — FOCAL POINT (1-2 tool calls)
- One specimen tree: place_object a single tree (the largest or most distinctive species available in the catalog) at a point offset from the garden center toward one corner — asymmetric placement is deliberate (the golden ratio: roughly 1/3 from one side, 2/3 from the other).
  This is the ONLY tree placed individually. Do not scatter more trees here.
- Garden beds: decorate_zone x=<garden_rect_inner> theme=garden — places flower beds across the inner garden area (inner rect = garden rect shrunk by 3 cells on each side).
  garden theme places species-pure flower beds; the decorator handles variety.

STAGE 3 — COMPOSITION CHECK (1 tool call)
- view_map to judge composition: look for asymmetric balance (focal tree off-center, hedges framing but not boxing, path cutting across). The garden should have more open space than planted space — if it looks dense, remove the last scatter with undo and re-scatter at count=<half the previous count>.
- evaluate_map. Target scores: terrainInterest >= 3 (low is fine — zen gardens are flat). No connectivity target (the garden is a single room).
  Skip a decoration score target — zen is deliberately sparse. Instead judge placement quality by the view_map check above: focal tree off-center, hedges not boxing, path visible, open ground dominant.

STAGE 4 — DONE-CHECK
Quality bars:
- Open ground >= half the garden interior: deliberately left empty (no fill-to-completion urge).
- Exactly ONE specimen focal tree placed individually.
- Hedge rows: 2 lines of the same species, flanking not surrounding.
- Garden beds (from decorate_zone): present but not overwhelming the open ground.
- view_map called: composition reviewed and signed off before reporting done.
Then STOP. Adding more is a mistake in this style.