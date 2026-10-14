TERRAIN SHAPING

Use these techniques for the landforms the user requested. The site, desired scale and preserved work determine the layout. Reference proportions and example shapes are not targets.

WHEN TO USE: creating hills, terraces, rivers or elevated water, or resolving terrain containment failures.

THE PLAN OF THE LAND
- Place higher ground where it supports the requested view and route. A backing ridge is one option; a local garden need not become a whole-map slope.
- Give usable terraces enough flat ground for their requested buildings, planting and access. A narrow ledge can be scenery, but does not substitute for a walkable floor.
- For a broad natural landscape, group related hills into coherent masses. Separate small landforms can suit a garden or an explicit arrangement.

TOOL MOVES
- Hills up to 3 tiers: sculpt_terrace (baseRadius 3-12, tiers 1-3, organic rounded cliffs). Overlapping calls can form a ridge; paint_terrain offers precise rectangles, circles or explicit cells for formal shapes.
- Taller than sculpt_terrace reaches: paint_terrain mountain with the FINAL elevation (it auto-builds support tiers; the elevation ceiling is in its schema, max 4000 cells per call — split big bands). Legality: V-MTN-03 (its rule hint gives the thresholds) asks a tall mountain cell for a full support window within the rule's reach below it, so a sheer face can drop at most that reach — step taller forms, each band inset 1+ cells inside the band one reach below it. Width before height.
- Edges: smooth:'round' on every organic paint; keep working edges crisp (pond rims, cliff lips a ramp will use). erase_terrain bites coves out of straight coasts; trim_corner for single stubborn corners.

WATER TECHNIQUES
- Ground pond: paint_terrain water elevation 0 on open grass. Surrounding flat ground contains it; no mountain rim is needed. Choose its size and outline for the requested scene.
- River: carve_river makes a channel through 3-5 waypoints that runs downhill, dropping over each terrace step it crosses in a framed waterfall. Where a bridge is needed, reserve a straight uniform span and verify it with find_bridge_sites. Add a river only when the brief calls for one.
- Pond in a terrace: build the bench at elevation N, then paint_terrain water elevation N on interior cells keeping a >=1-cell ring of mountain at exactly N. Size the pond to leave usable ground for its route and requested details.
- Waterfall: ONE lip, not drawn falling water. The lip is 1-3 water cells at elevation N framed by mountain at exactly N on both perpendicular sides, with the row directly in front already ONE uniform lower elevation (V-WTR-03). The game animates the fall. Give a fall a downstream: a pool or river below it.
- Cascade: when requested, repeat the contained pool and framed lip at each level, leaving enough bench depth for containment and any route.

ACCESS AS YOU GO
- Read the catalog ramp heightDrop and use the matching validated anchor for each required transition. find_ramp_sites after a tier lands; choose an orientation that connects the intended route.

FAILURE MODES
- Match the form to the brief. A flat garden or concentric formal terraces can be intentional; vary levels and outlines when the requested landscape benefits from them.
- Uncontained elevated water: inspect the banks and repair the missing support before another water call. Read retained changes after any rollback.
- Sealing the only connector between two areas: confirm a ramp or bridge site exists before raising a wall across a seam.

DONE CHECK: requested landforms and water are present, planned routes reach their destinations through placed crossings, and preserved areas remain. A legal ramp site is only a candidate; verify the actual ramp and connecting path. No score threshold or terrain percentage is required.
