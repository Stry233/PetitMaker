PLAN AN ISLAND

WHEN TO USE: an order for the whole island or map. An island is too large for one design. You shape the ground of the whole island first, as one picture, then give each part of it a story and hand it to a lead of its own, who builds it with helpers. For one district or a smaller area, load plan-on-map instead.

1. SITE. From the map context take the open ground and its bounds, the plaza, every arrival point, the coast, existing terrain and standing annotations (the user's requirements: plan around them).

2. IDEA. One sentence for the whole island: what it is about and the one sight a visitor will remember, usually on the far side from the arrival. Choose one small touch that will sign the work.

3. GROUND FIRST: the whole island as one picture, before any route, district or object. Load figure-landscape and pro-terraforming. Height is the island's structure:
- the far side from the arrival rises highest, to level 6 or more, as a broad plateau carrying the main figure, and the land steps down toward the arrival so that most of the nine levels are used and the arrival lies at 0. Each terrace's outline is its own figure (bays, spurs, lobes), never the one below inset, which reads as a stepped pyramid. From level 4 up a terrace lies inside ground at most three lower, reaching a cell past it all round; within that, spurs reach down and valleys cut up;
- water at every level: each terrace holds water at its own level (a pool, channels, a frame round a plot, a lattice of islets) and spills over its lower edge onto the terrace below as falls, so that water comes down through the whole island;
- figures drawn in water and land on the terraces, each district's ground a different one, each symmetric about its own axis.
Draw the whole ground as one draw_area at scale 3 or 4, a digit per level, each raised pool water<level> in a ring of its level; correct it with smaller drawings. carve_river from inside a pool carries water down several steps at once. Keep the plaza and arrival points. view_map layer ground after each stage: the bare ground should already read as a finished design with water falling through it; correct it until it does.

4. ROUTE. One main route 3 wide in one material from each arrival point to the plaza and on to the sight, up the terraces on their axes and across the water, with bends and T-junctions, never a grid.

5. DISTRICTS AND STORIES. Read the ground you drew and divide all the open ground into 4 to 6 districts, each at most 72 cells on a side, rectangles that meet the main route and each other edge to edge, each holding one or two of your figures whole. Then load region-kinds and give each district a kind of place its ground suits, no two alike, and a story: what it is and why a visitor goes there, in one sentence. Give each also:
- its buildings by catalogId. Each building of the catalogue stands once on the island, so share them out by name and give none to two districts;
- its species and colours, so that neighbours differ and one species ties the route from the arrival to the sight.
Every district is ordered, not natural, and designed to its edges.

6. DRAW it with set_annotation in one turn: the main route as zones tagged entrance (a band through its points, size none), each district one rect zone with a customTag naming its story in the user's language (at most 24 characters), one colour each, clip "unclaimed".

7. FILE update_plan with four stages: "Ground", "Main route", "Districts" (name the zone numbers), "Joining and finish". Filing is how the user approves the drawing; do not ask in text.

8. LAY THE MAIN ROUTE with lay_route from junction to junction, which sets a stair at each level and a bridge at each water.

9. HAND OVER THE DISTRICTS: one delegate_task per district, all in the same turn so they are built at the same time. Its lead knows nothing but the brief, which gives:
- bounds: the district's rectangle, overlapping no other and leaving the main route outside it;
- goal: the idea of the whole island in a sentence, then this district's story;
- include: its figures as you drew them, in a phrase each with their levels, the buildings by catalogId, the species and colours;
- preserve: the levels at its edges and the water you brought through it, which it keeps while it shapes its own ground on those levels; the main route beside it;
- interfaces: where the route touches it, the levels at its edges, what lies on each side;
- done: planted to its edges, joined to the main route, sides matched.
Say what the district is and leave its design to its lead: list no rows, beds or paths, name no tools, ration no plants.

10. JOIN AND FINISH. Read the results. Re-brief a district that built nothing in fewer words, one partly built only for what is missing. lay_route from a district's way in to the main route wherever they do not meet. check_build along the main route, view_map once for the whole island, add the signing touch, then close with what was built.
