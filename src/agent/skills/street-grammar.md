STREET GRAMMAR

WHEN TO USE: connecting a settlement, making a route through terrain, or repairing an existing network.

ROUTE HIERARCHY
Main routes should be continuous and easy to follow, branches should lead to destinations, and small paths can serve intimate gardens. Widths of 3, 2 and 1 cells are useful starting examples, not required proportions. Keep the user's chosen widths and materials when extending existing work.

PLAN THE CONNECTIONS
- Decide what the route connects before drawing it. Respect existing road stubs and preserve useful sections.
- Prefer readable junctions. T-junctions, offset crossings and bends can suit a natural town; straight paths and regular grids are valid when requested.
- A road cell needs its right and bottom neighbors level and dry because the flat trait checks a placement margin. At a south or east cliff edge, leave that margin and connect through a validated crossing.
- find_bridge_sites and find_ramp_sites return legal anchors. Use them before placing a crossing instead of trying arbitrary coordinates. Check the ramp's actual heightDrop in the catalog; connect the levels the route needs.

METHOD
1. Read the endpoints and their elevations with get_objects or inspect_region. Choose a direct useful route within the allowed area.
2. build_road lays a line or explicit cells in one stroke. For multiple destinations, build_road_network can route a broad network when the entire network is in scope.
3. Keep branches connected and make paths arrive at doors, viewpoints or other requested destinations. Check the actual placement results at crossings and level changes.
4. If one segment fails, preserve the rest and repair the gap. Do not clear a whole crossroads or network for a cosmetic change.
5. Verify connectivity with a focused read or view_map. evaluate_map can suggest broad network issues, but its whole-map score is not a local route's completion criterion.

DONE: the requested endpoints are connected, route widths and materials fit the brief, and existing routes remain useful. Additional spurs, bridges or ramps are not required unless they serve the request.
