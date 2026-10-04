DESIGN REVIEW

WHEN TO USE: checking a complex scene or a requested improvement. Review only the area and outcomes the user asked for. Exact instructions and preservation requirements outrank style preferences.

1. Read the request again. List the required features, counts, connections and exclusions. Compare them with actual tool results, including partial placements and rollbacks. A summary is not evidence that a feature exists.
2. Look at the relevant area with view_map; use get_objects or inspect_region for details a picture cannot establish. Check entrances and route endpoints, open foreground and supporting background, readable planting groups and the intended focal point. Apply only checks relevant to this scene: a flat garden needs no climb, and three requested trees need no other decoration.
3. Decide whether anything requested is missing or visibly misplaced. If so, repair that specific defect while preserving the successful parts. Verify the correction once. If the result already meets the request, stop.

AESTHETIC QUESTIONS
- Does the approach lead to something useful or interesting? Can a visitor reach the requested destinations?
- Do building entrances face clear ground? Does background planting frame rather than obstruct the view?
- Are planting groups and open spaces intentional at this scale? Repetition may express a formal style, and mixed species may belong to an existing garden.
- Does water have a legible place in the scene? Does requested elevation support access and views?

OPTIONAL DIAGNOSTICS
- evaluate_map reports whole-map heuristics. A low score or a REGRESSED trend is a lead to investigate, not a failed request. Do not add missing categories or change unrelated areas to raise a score.
- find_speckle suggests planting patches to inspect. Its rectangles can contain intentional plants, roads, terrain or other work. Never clear a whole rectangle solely because it appears in the report.

REPAIR TOOLS
- Missing route connection: add a short build_road segment after checking the endpoint; use find_bridge_sites or find_ramp_sites for a crossing.
- Obstructed entrance: remove_object for the specific obstruction or rotate_object if the requested orientation permits it.
- Planting gap: add only the missing plants with place_object or a bounded scatter_objects call. Preserve the established palette and intact bed.
- Terrain defect: inspect_region, then paint_terrain or trim_corner only the affected cells. Do not flatten and rebuild a finished landform.

DONE: required outcomes are present, preserved work remains, and remaining limitations are stated plainly. Report the result, not diagnostic scores or an invitation to endless polishing.
