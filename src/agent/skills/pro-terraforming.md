PRO TERRAFORMING PLAYBOOK — terrain IS the design; objects only dress it.

TOOLS OF THE TRADE
- sculpt_terrace: organic multi-tier hills with rounded cliffs — your default for ANY hill. Vary seed per hill so no two match.
- carve_river: meandering water through waypoints — your default for ANY river.
- paint_terrain with smooth:'round' for custom shapes; erase_terrain to bite inlets/coves out of shapes.
- clear_area first when reshaping over existing content.

COMPOSITION RULES (what makes it look professional)
1. Two to three elevation levels visible in a scene, never one flat plane and never a wedding cake of 4+.
2. Cliffs run DIAGONALLY across the space or in S-curves — sculpt_terrace blobs at different centers, overlapping, give this for free. Straight cliff walls along a row look engineered.
3. Rivers meander: 3-5 waypoints with 4-8 cell sideways offsets. Width 4 in the middle of the map, widen the mouth (width 5-6 segment) where it meets the sea/void edge.
4. Negative space: leave at least a third of any scene as open flat grass. Terrain crowding reads as noise.
5. Asymmetry: hills off-center, river crossing at the scene's third-line, pond NOT in the middle.

SET PIECES (proven sequences)
- Layered backdrop: two sculpt_terrace calls (r 7-9, tiers 2-3) with centers 8-12 apart so the blobs merge into a ridge; one smaller (r 4, tiers 1) in front as a foothill.
- Elevated pond: sculpt_terrace r 6+ tiers 1-2, then paint_terrain water at the TOP tier's elevation on its interior cells (keep a full 1-cell mountain ring — check the result snapshot).
- Waterfall (advanced): a waterfall is ONE high water cell at a cliff edge, NOT water you draw flowing down — the fall animates itself. Never paint a stream/line/river of water descending the slope (it always reverts on V-WTR-03). Steps: (a) elevated pond at elev N (contained ring); (b) build the LANDING FIRST — the row directly in front of the drop must already be ONE uniform lower elevation across the whole width; (c) paint_terrain water elev N on 1-3 LIP cells that have mountain at exactly N on both perpendicular sides. The falling water stays at elevation N. If REVERTED, the lip frame or the landing row is uneven: square that segment with paint_terrain (no smooth) and retry ONCE.
- River + lake: carve_river through 4 waypoints, then a paint_terrain water circle (r 3-4, smooth round) overlapping one bend — the lake reads as the river widening.
- Cove/peninsula coast: along a sea edge, alternate erase_terrain bites and small mountain blobs (r 2-3, smooth) to break a straight shoreline.

WORKFLOW
- Sculpt large→small: ridge, then river, then foothills/pond, then coast detail.
- Check each tool's result snapshot; fix as you go rather than auditing at the end.
- Finish with planting only AFTER all terrain: waterside flora drifts, tree stands on mid tiers, the high tier mostly bare (a lookout reads better sparse).