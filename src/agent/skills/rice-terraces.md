RICE TERRACES PLAYBOOK — stepped cultivation terraces hugging a slope, each bench holding a contained pond, with a hamlet at the foot and ramp links between levels. Work in 5 STAGES, in order.

STAGE 0 — SIZE & SITE (1-2 tool calls)
- SIZE FROM THE MAP: slope = clamp(round(min(mapW, mapH) / 3), 26, 48) cells.
  Terraces need depth for the stepped effect — at least 3 bench rows each 6-8 cells wide.
  bench_count = clamp(floor(slope / 8), 2, 3).  Each bench is 1 elevation unit above the last.
  Elevations above 3 need 3x3 support below (V-MTN-03); stay at 3 benches unless you widen each bench by 3+ cells.
- update_plan: record the five stages, the slope anchor, and bench_count before starting.
- find_flat_areas minWidth=<slope> minHeight=<slope/2> — the terrace should climb from one edge of this area upward.

STAGE 1 — TERRACE STRUCTURE (bench_count * 2 calls) — carve the steps
Build the terraces bottom-up; each bench is exactly 1 elevation unit above the previous.
- For each bench tier i (starting at 1, up to bench_count):
  paint_terrain mountain elevation=i rect covering the bench footprint:
    x1=<slope_x>, x2=<slope_x + slope>, y1=<slope_y + (bench_count - i) * 8>, y2=<slope_y + (bench_count - i + 1) * 8 - 1>
  The tallest tier has elevation=bench_count and sits at the TOP of the y range (smallest y values).
  Use NO smooth option — rice terraces have straight edges, not organic blobs.
- After all terrain: evaluate_map. Target terrainInterest >= 5 (stepped elevations should register).
  If terrainInterest < 4, add one more sculpt_terrace at the uphill end as a capping ridge.

STAGE 2 — PONDS (bench_count calls) — one per tier using the legal water-on-mountain recipe
For each bench tier i (elevation=i):
- paint_terrain water elevation=i on INTERIOR cells of that bench only.
  The interior means keeping a >= 1-cell mountain ring at exactly elevation=i on all four sides of the pond.
  Use a rect 2-3 cells smaller than the bench footprint, centered: this guarantees every pond neighbour is
  that tier's own mountain mass with no exposed face (V-WTR-02 satisfied by construction).
  If REVERTED, the pond extends to the bench edge — shrink the water rect by 1 cell per side and retry once.
- Do NOT connect ponds to each other with water cells; each pond is self-contained.
- evaluate_map after all ponds. Target: terrainInterest >= 7 (water + multiple elevations).

STAGE 3 — ACCESS & HAMLET (3-5 tool calls)
- find_ramp_sites for each tier transition (elev i+1 to elev i).
  Pick ramp anchors that stagger across the terrace width — alternate between the left third and right third
  of the bench face so the path zigzags rather than going straight up.
- place_object each ramp at a returned anchor (heightDrop snap handles orientation).
- Hamlet at the foot: decorate_zone x=<hamlet_rect below tier 1> theme=hamlet.
  hamlet_rect = the flat ground area below the lowest bench, roughly <slope_x> to <slope_x + slope/2>,
  y2=<slope_y + bench_count * 8 + 6>. The hamlet decorates the entry village.
- build_road road-dirt line from the hamlet center to the foot of the lowest ramp — the access road.
- evaluate_map. Check connectivity (every bench reachable: all tiers connected through ramps should yield 10/10
  on an isolated map; at minimum connectivity >= 7 on a larger map with other zones).

STAGE 4 — FIELD DRESSING (1-2 tool calls)
- Farm fields: decorate_zone x=<field_rect> theme=farm on the dry portions of each bench (the area beside
  the pond that is still mountain but not covered by water). One decorate_zone call per bench is fine;
  use the side strip rect: full bench width, 2-3 cells wide along the bench's waterless side.
- plant_forest on the slopes ABOVE the top terrace: the uphill ridge area, density=0.4.
  The forest caps the scene and prevents the terraces from floating in open space.

STAGE 5 — DONE-CHECK
Quality bars (use evaluate_map scores):
- terrainInterest >= 7: multiple elevation steps + water present on each tier.
- connectivity >= 7 (ideally 10/10): every bench reachable via ramps placed in Stage 3.
- decoration >= 4: hamlet + farm fields + forest present.
- Every pond enclosed: no REVERTED; each pond visible in the token snapshot surrounded by mountain ring.
- Hamlet present: decorate_zone hamlet landed with at least 1 object placed.
Then STOP — adding more decor risks overwhelming the terrace geometry.