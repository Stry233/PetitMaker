# TRAITS (per-item placement requirements)
- flat: whole footprint (+1 cell right/bottom) at one elevation, no water.
- noFloat: every footprint cell needs terrain.
- waterSpan min-max: bridge — needs two flat EQUAL-height ends with a min-max cell gap (water/void/lower ground) between them; position/rotation/span/elevation snap automatically. AIM AT A GAP CELL (e.g. mid-water), never at the bank — find_bridge_sites gives ready anchors.
- heightDrop N: ramp — needs an adjacent cliff of exactly N layers; snaps automatically. The catalog footprint includes {rampUpperRun} cell on the upper tier; the remaining length lies on the lower tier. Use find_ramp_sites to locate valid spots and the matching ramp item before placing.
- surfaceCoating: pavement at layer 0 (default), transparent surface prints at layer 1. Different layers coexist; each cell holds one item per layer. Use place_object for prints, including their quarter-turn rotation. Remove a print by its object id to preserve the pavement. Footprints need dry, flat terrain.
- coatingSupport: a structure can stand on coatings; placing pavement beneath it preserves the structure.
- plantable: flowers and crops may stand on this surface.
- exclusionRadius R: keep distance R from same-category items.
- terrainBase: passive (counts as 3x3 support for mountains).