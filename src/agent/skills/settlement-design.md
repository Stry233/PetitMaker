SETTLEMENT DESIGN

WHEN TO USE: placing several buildings or composing a home with its setting.

CATALOG AND SITE
The catalog and current objects determine available buildings, footprints and maximum counts. Use distinct available homes when multiple copies are not allowed. find_flat_areas can find sites with the needed placement margin; confirm the entire footprint and its approach fit inside the selected region.

HOMES AND ROUTES
- Give each requested home some usable space around it. A small yard, planting group or view can make it feel like a place; no extra theme or building is mandatory.
- Face entrances toward open ground and useful routes. A tree stand or raised ground can provide backing, but keep the foreground and door approach clear.
- Put daily destinations along a direct main route when arranging a settlement. Let branches reach homes and quiet places. Do not force a local scene to encircle the plaza or include every available building.
- Adapt spacing and repetition to the requested style. A deliberate row of houses should remain a row.

METHOD
1. Read the requested building count, existing buildings and preservation constraints. Choose a coherent layout with space for access before placing anything.
2. Place the buildings with their orientation decided. Read each result for the actual position and any rejection.
3. Connect the requested entrances using build_road. For a broad settlement, build_road_network can provide a starting network, but it can reach beyond one yard; use it only when that scope is intended.
4. Add only the requested planting or facilities. scatter_objects works for beds and rows, while place_object gives precise counts. Avoid a hamlet macro when its extra homes would change the requested count.
5. Verify the buildings, paths and entrances with get_objects and a focused view_map. Correct a missing connection or obstruction locally.

DONE: requested buildings are present in their intended arrangement, entrances are accessible, and existing work outside the task remains. Do not add homes, yards or terrain solely to increase a whole-map score.
