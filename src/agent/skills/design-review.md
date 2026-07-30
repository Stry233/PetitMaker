DESIGN REVIEW — the expert's finishing crit; run it before declaring any large build done.

WHEN TO USE: at the end of every multi-stage build, after the last plan stage completes;
or when the user says the map "looks off" / "make it better" without a specific ask.

THE PASS (in this order — cheap signals first)
1. evaluate_map. Note the overall trend and the TWO weakest dimensions. Anything
   regressed since your last evaluation gets fixed first — a regression you caused is
   the highest-priority defect on the map.
2. view_map. Judge what metrics cannot:
   - SILHOUETTE: do cliffs and shores curve, or are they raw rectangles? Straight walls
     longer than ~10 cells need insets, curves, or a terrace step.
   - FOCAL HIERARCHY: is there ONE place the eye lands (tallest hill, the waterfall,
     the village heart)? Two equal masses = split attention; demote one.
   - BALANCE: is all the content crowded in one half? A big empty quadrant needs either
     a modest feature or a deliberate meadow (open space is fine; dead space is not).
   - STORY MOMENTS: a map is remembered by 2-3 scenes — a bridge over a falls, a lookout
     over the village, a lane between hedges. If you cannot name the scenes, create one.
3. Walk the approach: pick the map entrance or plaza, follow the road network in your
   head to each feature. Every destination needs a path; every path needs a destination.

FIX PLAYBOOK (symptom → tool)
- Raw/straight cliff edges → paint_terrain smooth:'round' over the same cells, or
  trim_corner the specific corners the silhouette hints name.
- No focal point → raise the main hill one tier (sculpt_terrace on top of it) or crown
  it (peak theme decorate_zone / a lookout ring of trees).
- Unbalanced mass → add a counterweight feature at 1/3 of the empty side, smaller than
  the focal one; connect it with a road so it belongs.
- Orphan features → build_road from the nearest network point; frame_crossing where the
  route crosses water or a cliff.
- Confetti decoration → clear_area the worst patch, replant as drifts (scatter_objects
  with 2-3 species over a SMALL rect, repeated in clusters).
- Bare shores → a flora line 1-2 cells off the waterline on the outer bank.

DONE CHECK
- evaluate_map: no dimension below 5, nothing regressed, overall at least as high as
  before your changes.
- view_map: you can name the focal point and 2-3 story moments out loud.
- One final short report to the user: what you built, the scenes worth visiting, and
  one thing they might want to tweak by hand.
