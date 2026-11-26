Layout patterns: how a place is designed and built as a drawing. Adapt sizes to the area; the user's constraints and existing work come first.

Method
1. The idea. One sentence on what the place is about and what a visitor will remember, an idea of your own for this request. Decide the one thing that carries it and where it stands.
2. The parts. Divide the whole area into parts so that no part is left over: the one that carries the idea, the calm ones that let it be seen, the way in, the edges. Give each part a kind of ground and a rule for what fills it.
3. The ground, drawn first for the whole area with draw_area: digits for levels (the way in low, the idea raised, steps between), "~" for water, "." for ground left as it is. Draw outlines as shapes: stepped corners, a notch, a bay, a figure, an island inside a pool, a pool inside a terrace.
4. The paving, drawn over the ground: the path in from the edge of the area to the idea, one material, 2 or 3 wide, a second paving only as a border or a threshold; courts under and around buildings. lay_route joins two points across a level or water with the stair or bridge it needs.
5. The planting and the rest, drawn part by part: each part one rule (a lattice, stripes, a checker of two species, a frame, a nest of frames), a different rule or pitch in the next part, species kept to their own parts, tints of one hue side by side.
6. Check. check_build over the area once; view_map once to see whether the idea reads at all three scales (the whole, its parts, their texture) and whether any part is still plain lawn that was not meant to be. Correct with a small drawing, replace true where something must give way.

Drawing well
- One drawing for the whole area. Take the area's corners, give x, y and x2, y2, and write every row at the area's width, or at half of it rounded up with mirror "x" (a quarter with "xy"): the tool completes the drawing to exactly x2,y2 and refuses a drawing of the wrong size. Parts drawn in one picture line up by themselves; parts placed by separate calls drift.
- Plan it as a table of bands, not as a draft: which columns are margin, border, path, beds, and how wide; which rows. Equal margins on both sides, equal gaps between equal parts, the path on the middle. Then write the rows straight into the call; never write them out in your reasoning first.
- A drawing can hold ground, paving and plants together: define a letter per thing in legend, and use "+" for a thing on raised ground ("a=1+" before a paving id). A thing with no level of its own stands on the level drawn around it.
- For a texture, draw one small unit and tile it with repeatX and repeatY: a unit of 3 by 3 with one plant makes an orchard, a unit of two rows makes stripes. Change the unit between parts.
- A crowded area may take two drawings over the same corners: the ground and paving, then the planting with "." everywhere else. A later drawing leaves "." cells untouched.
- A thing that stands alone at the centre of an islet, a platform or a bed needs it an odd number of marks across (1, 3 or 5), so that it has a middle cell.
- Keep one free cell between trees, between a tree and a building, and around water where something should stand. Buildings and trees need level ground one cell around them.
- Read the result: it counts what landed per mark and names refused cells. Fix those cells with a small drawing; do not redraw the whole.

Composition devices
- Axis: the way in, the path and the idea on one line; everything either side mirrored.
- Frame: a border of one thing around a field of another; frames nest, each ring a different thing, the centre kept for one accent or left empty.
- Field: a part filled by one rule. Vary rules between neighbours: lattice against stripes, pitch 2 against pitch 3, one species against two alternating.
- Figure and ground: a shape cut into its surroundings, in water, in raised ground, in paving or in planting. The same figure can be used again inside out.
- Step: levels rising away from the way in, each band with its own planting row, the stair on the axis.
- Threshold: where the path enters a part, a cell or two of a second paving and a matching pair either side.
- Contrast: dense beside open, straight beside stepped, water beside paving. A part that is plain on purpose makes its neighbour read.

Sizes that work
- A path 2 or 3 wide; a border 1 wide; a bed 3 to 6 wide; a pool at least 4 across; a stroke of a figure 2 or 3 cells thick; a court 2 cells wider than its building on every side.
- A house plot: the house at the back, a path from the door cell its result reports to the route, matching beds either side, trees behind.

Rules that save a retry
- A path cannot lie on a bank or a step ("=" or "^" in a read of the map); cross them with lay_route.
- When some plants were refused, keep what landed and fill only the gaps the result names.
