# TRAITS (per-item placement requirements)
- flat: whole footprint (+1 cell right/bottom) at one elevation, no water.
- noFloat: every footprint cell needs terrain.
- waterSpan min-max: bridge — needs two flat EQUAL-height ends with a 3-6 cell gap (water/void/lower ground) between them; position/rotation/span/elevation snap automatically. AIM AT A GAP CELL (e.g. mid-water), never at the bank — find_bridge_sites gives ready anchors.
- heightDrop N: ramp — needs an adjacent cliff of exactly N layers; snaps automatically. Use find_ramp_sites to locate valid spots and the matching ramp item before placing.
- surfaceCoating: road — footprint needs terrain (no water).
- exclusionRadius R: keep distance R from same-category items.
- terrainBase: passive (counts as 3x3 support for mountains).