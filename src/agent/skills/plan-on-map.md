PLAN ON THE MAP

WHEN TO USE: a design for one district or several areas, up to a few thousand cells, or an order asking for a plan. For a whole island load plan-island instead. Draw the plan with set_annotation before any terrain or object edit; the filed plan is a short legend. To build from the user's own annotations, load build-from-plan.

1. SITE. From the map context take the open ground and its bounds, the plaza, every arrival point, the coast, existing terrain and standing annotations (the user's requirements: plan around them).

2. IDEA. One sentence for the whole area: what it is about and the one sight a visitor will remember, and where that sight lies. A brief you were given states these; keep them.

3. LEVELS, one gesture for the whole area on the level you were given: a rise toward the sight in one to three steps, the way in lowest. Every place takes the level it lies on. Keep the levels at your edges and the water your brief preserves; inside, shape your own ground on them.

4. ROUTE. One main path 2 or 3 wide in one material from the way in to the sight, joined to the routes at the area's edges. Branches 2 wide leave it so that every place touches a path. Paths run along the borders between places, never through the middle of one.

5. PLACES. Divide all the open ground between the paths into places, 4 to 8 for a district, each about 400 to 1200 cells and seldom over 40 on a side, rectangles that meet the paths and each other edge to edge with nothing left over. A helper builds one place and is refused a larger one, so cut a large idea (a hill, a long shore) into halves that answer each other. Where the area is symmetric about its main path, plan the places of one side only; the other side is their mirror image. For each place decide:
- its idea, in one phrase no other place repeats, stated as ground, structure and planting: what the land or water draws, what divides it, what rule fills it;
- its level, and the cell where a path enters it;
- whether it carries a main idea or supports one. A supporting place still has its ground designed and is planted to its edges by one rule; none is left as open lawn with a few things on it.
Every place is ordered, not natural: figures, frames, rows and lattices, mirrored about the line its way in lies on. Vary the kind from neighbour to neighbour; region-kinds lists them. Each building of the catalogue stands once, in a place of its own composed around it.

6. DRAW it with set_annotation in one turn: each path a zone tagged entrance (a band through its points, size none), each place one rect zone with a customTag naming its idea in the user's language (at most 24 characters), one colour per kind, size s, clip "unclaimed".

7. CHECK once with get_annotations: every place touches a path, no open ground unplanned. Repair with mode add or cut.

8. FILE update_plan with three stages: "Ground and paths", "Places" (name the zone numbers), "Joining and finish". Filing is how the user approves the drawing; do not ask in text.

9. BUILD THE GROUND AND PATHS yourself. The ground of the whole area first, as one draw_area drawing over its corners (mirror for a symmetric area): the levels in digits, the water, the figure of the main sight. Keep what your brief preserves. Then the main path and branches with lay_route from junction to junction, which sets a stair at each level and a bridge at each water.

10. HAND OVER THE PLACES: one delegate_task per place, all in the same turn so the helpers work at the same time; for a symmetric area brief one side only. A helper knows nothing but its brief, so each brief gives:
- bounds: the place's rectangle, inside the paths, overlapping no other;
- goal: the idea of the whole in a sentence, then this place's idea and what makes it memorable;
- include: its ground figure with sizes (the pool, the terrace, the channel and their shape), what divides it, the rule that fills each part and the species or colours to use so neighbours differ, the building's catalogId if it has one;
- preserve: the paths that run along or into it;
- interfaces: the cell where the path enters, the ground level, what lies on each side;
- skills: layout-patterns, neighbors for a place with a house; done: every part planted to its edges, the way in joined, sides matched.
Say what the place is, not which tools to use. Never ask for scattered, sparse or informal planting, and do not ration plants for the load cap: say that planting in numbers uses the light species.

11. JOIN AND FINISH. Read the results. Lay the mirrored side with mirror_area across the main path, place by place; each building stands once, so a place with a house is briefed whole, never mirrored. Brief a place again only for what its report says is missing. lay_route from a way in to the path wherever they do not meet. check_build along the paths, view_map once, then close with what was built.
