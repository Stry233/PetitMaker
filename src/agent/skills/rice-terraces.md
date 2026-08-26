RICE TERRACES — cultivation benches climbing a slope, each holding a sunk pond and a dry field strip, with a zigzag ramp path and a hamlet at the foot. Straight edges are CORRECT here: terraces are built ground.

STAGE 0 — SIZE AND SITE (1-2 calls)
- Slope = clamp(round(min(mapW, mapH) / 3), 26, 48) cells wide; benches = clamp(floor(slope / 9), 2, 4), each bench 6-9 cells deep and one elevation above the last (a 1-step staircase is always legal at any height). find_flat_areas for slope x (benches*9 + 8). update_plan the stages.

STAGE 1 — THE BENCHES (one paint per bench)
- Bottom-up, one paint_terrain mountain per bench, NO smooth: bench i at elevation i, a full-width rect ~8 rows deep, each higher bench behind the last (toward the slope's top). Vary the bench fronts a little — shift one bench's edge 1-2 rows, taper the ends — so the staircase reads laid by hand, not extruded.
- evaluate_map; if terrainInterest sits under 5, cap the top with a sculpt_terrace ridge (tiers 1-2) behind the highest bench.

STAGE 2 — THE PONDS (one per bench)
- Per bench: paint_terrain water elevation=i on an interior rect 2-3 cells smaller than the bench each side — the >= 1-cell ring of the bench's own mountain at elevation i is the containment (V-WTR-02 by construction). If a pond REVERTS it reached the bench edge; shrink it 1 cell per side and retry once.
- Vary the pond shapes bench to bench (12x3, 9x4, an L of two rects) — identical ponds stacked in a column are a stamp. Keep each pond toward one END of its bench so every bench keeps a dry strip.
- Optional crown: one narrow framed lip on the top bench spilling toward the bench below (mountain at exactly that elevation on both sides, uniform landing) — a working overflow, not a show cascade.

STAGE 3 — THE CLIMB AND THE HAMLET (4-6 calls)
- find_ramp_sites per bench transition (each ramp climbs one layer); pick anchors alternating left third / right third of the bench faces so the path ZIGZAGS up. place_object each.
- Hamlet at the foot: decorate_zone hamlet on the flat ground below the lowest bench, then a 2-wide build_road lane from the hamlet through the ramp feet — the working route the farmers walk. Pave a short 2-wide run along each bench's dry strip between its ramps.

STAGE 4 — FIELDS AND FRAME (2-3 calls)
- decorate_zone farm on each bench's dry strip (full bench width, 2-3 cells deep beside the pond) — crop rows ARE the right regularity here.
- plant_forest above the top bench (density ~0.4) so the terraces climb into something; leave the bench fronts and the water edges bare — the terrace geometry is the ornament.

DONE BAR: every bench reachable by the zigzag (connectivity >= 7); every pond enclosed with a dry strip beside it; hamlet at the foot on the lane; forest cap above; pond shapes varied. Then STOP — more decor buries the geometry.
