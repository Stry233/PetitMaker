DESIGN REVIEW — the finishing crit before calling a build done, judged the way the expert maps are judged.

WHEN TO USE: at the end of every multi-stage build; or when the user says "make it better" / "it looks off" with no specific ask.

PASS 1 — MEASURE (cheap, first)
- evaluate_map. Fix anything marked REGRESSED before anything else — a regression you caused is the map's highest-priority defect. Then note the two weakest dimensions.

PASS 2 — LOOK (view_map), against the expert tells, in this order:
1. THE SUBJECT: can you name what the island is about — one primary set piece, clearly bigger than everything else, with clear ground around it? Two rivals = demote one; no answer = crown something (raise the main mass, give it a fall or a court).
2. THE CLIMB: on a map with terrain, does the walk change level, or does all pavement sit on one floor with the mass beside it? Pavement belongs ON the benches; ramps are route events, not fire escapes.
3. ARRIVAL: do any streets END at something (a door, a lookout, a waterside platform), or does every route only pass through? A network of through-streets arrives nowhere.
4. FRONT AND BACK: pick 2-3 buildings — open low scenery out the door, mass behind? A building composed backwards (wall in front, void behind) is a two-call fix: rotate it or move the planting.
5. STAMPS: judge repetition by the map's dialect. Scattered congruent shapes (identical ponds, twin hills) are stamps everywhere; ALIGNED repetition in the formal dialect (an edging ribbon, an orchard grid, twin courts, crop plots) is the style working. A copy that is neither aligned nor mirrored gets deleted or varied.
6. GRAIN: run find_speckle — it names every patch that is neither bed, row, lattice nor specimen, and every mixed one, as a rect. Clear each named rect back to lawn or replant it as ONE species in a fill/grid; the sweep is done when find_speckle answers clean.
7. SILHOUETTE: raw straight cliff walls and dead-straight coasts longer than ~10 cells need a bend, an inset, or smooth:'round' repainting.

PASS 3 — WALK IT: follow the trunk from the plaza in your head. Every destination needs a route, every route a destination; name the 2-3 scenes a visitor would remember (the bridge over the fall, the lane between hedges, the lookout over the roofs). If you cannot name them, make one.

FIX PLAYBOOK (symptom -> tool)
- No focal point -> raise the main hill (paint_terrain a higher inset band or sculpt_terrace on top) or give it the one elaborate treatment (a fall, a paved court).
- Single-storey walk -> pave the benches (build_road on the high floors), then find_ramp_sites + place_object to stitch levels.
- No arrivals -> 2-wide build_road spurs from the network to 3-4 doors and vantages; frame_crossing to turn a crossing into an event.
- Raw edges -> paint_terrain smooth:'round' over the same cells, or trim_corner the named corners.
- Confetti -> clear_area the patch, one species scatter_objects bed + one specimen.
- Bare water -> a bed on ONE bank at the viewing side, a specimen on the outer bend; never a full flower ring.
- Empty quadrant -> a modest secondary feature at its third-point, connected by a lane — or declare it the map's deliberate meadow and leave it.

REPORT: evaluate_map once more (nothing below 5, nothing regressed, overall not lower than the baseline), then 2-4 sentences to the user: what got built, the scenes worth visiting, one thing they might tweak by hand.
