BUILD FROM THE PLAN

WHEN TO USE: building what annotations describe, your approved plan or a drawing the user asks you to build ("build what I drew"), rough, partial or untagged included.

1. READ every annotation with get_annotations: number, tag or custom name, cells and bounds, neighbours and what each zone already holds; chips, routes and measures too. Zones are the brief: their bounds, names and numbers outrank your own taste.

2. INTERPRET each one as the game can build it, through the catalog's categories and the tools:
- homes: houses with yards and gardens, each capped house id once; when the zone asks more homes than the catalog allows, build what it allows and say so;
- shops, a cafe, a library or another venue: a facility or stall with paving and planting composed as that place;
- farm: crop rows (decorate_zone farm); orchard: fruit trees in rows; garden: flower beds; forest: plant_forest;
- water: paint_terrain water at ground level; a path zone or a route: a road along it that reaches what it leads to; reserved: nothing; a measure: a size to respect.
- a chip naming a place (a picnic spot, a viewpoint, a meeting point): a small built spot at its point, joined to the nearest path.
- density: a zone reads as its use when it is filled to match, a forest dense across the whole zone, a meadow or bed covered, homes with their yards over the plot; plant a zone in one call over all of it rather than a corner.
- Read a custom name in any language by its meaning. Give an untagged zone the use its shape, neighbours and the order suggest, and say what you assumed; ask only when the choice would change the result a lot. Where nothing in the catalog matches, build the closest substitute and say so.

3. ORDER: water and terrain first, then roads along path zones and routes, joined to the plaza, then structures in their zones, then planting and details; otherwise number order.

4. BOUNDS: pass zone (the zone's number) to paint_terrain, scatter_objects, decorate_zone, plant_forest and build_road so each edit keeps to that zone's cells. Keep path zones for roads and nothing in reserved zones. Never edit, move or remove an annotation while building: the plan stays as approved, and a change to it is a question for the user.

5. CHECK with get_annotations: zones holding nothing, content standing outside every zone, path zones without road. Repair what you can, then report each zone or route you could not build and why.
