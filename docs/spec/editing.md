# Editing

This area covers how the editor changes a map: painting and erasing terrain and water, layers, corner cuts, undo and redo, selecting, moving, rotating and deleting objects, roads, bridges and ramps, curves, and how both views and the keyboard reach the same edits. The building rules every edit must pass are in the rules area.

## Painting terrain and water

- **EDIT-01** The terrain brush and the eraser draw in five shapes: freehand, line, curve, rectangle and circle. A line, rectangle or circle is laid only when the press is released, so it can be re-aimed while dragging, and holding the constrain key (Shift by default) squares a rectangle.
- **EDIT-02** A line, curve, rectangle or circle lays every part of itself the rules allow: a refused part, such as a stretch over the sea, a landmark or a locked layer, is skipped and the rest is laid.
- **EDIT-03** Outside the planet editor, a freehand mountain dab is a single mark: if any cell under the brush is refused, none of that dab is laid. A freehand water dab lays the cells that can hold water and skips the rest.
- **EDIT-04** A fast freehand drag paints every cell along the pointer's path, edge to edge, with no gaps between pointer samples.
- **EDIT-05** The mountain brush builds each cell up to the selected layer, filling the column beneath it.
- **EDIT-06** Painting over a mountain that already reaches the selected layer raises it by one layer, so repeated strokes over it keep climbing, while fresh ground beside it still gets the selected layer; the mountain brush never lowers terrain.
- **EDIT-07** A mountain asked to rise higher than its support allows settles at the highest layer the rules accept, and the editor names the support rule with its numbers. Source: V-MTN-03.
- **EDIT-08** Unless a layer is pinned, water lands on the surface under the brush, so one stroke down a terraced slope lays water on each terrace at that terrace's own level; with a layer pinned, water paints at that layer wherever the ground can hold it there.
- **EDIT-09** When the rules withdraw a water stroke and exactly one layer would hold that water, the editor names that layer.
- **EDIT-10** Painting mountain over water turns the water into mountain at the water's own level instead of stacking a block above it; a further stroke then stacks as usual.

## Erasing

- **EDIT-11** Each eraser takes only its own surface: the mountain eraser lowers a mountain by one layer per pass and skips water, the water eraser takes water and skips mountain, and the road eraser lifts road tiles and leaves the terrain beneath. A cell crossed more than once in one stroke is lowered once, and the whole gesture is one undo step.
- **EDIT-12** The water eraser turns raised water into mountain at the water's own level, and turns water at ground level back into grass.

## Layers

- **EDIT-13** The ground is the bottom layer and always exists, terrain stacks on it up to the game's highest layer, and every layer number the editor shows follows the game's numbering, in which the ground is layer 1.
- **EDIT-14** A locked layer refuses every edit that would change it, from any tool or shape, and automatic trimming leaves terrain standing on a locked layer as it is. Source: V-LOCK-01.
- **EDIT-15** The eraser and automatic trimming pass over terrain whose top stands on a hidden layer, leaving it as it is rather than refusing the stroke.

## Corner cuts

- **EDIT-16** The corner tool cycles each free corner of a terrain block from square to a quarter-circle round, then a 45-degree bevel, then back to square, and every corner at a junction cycles independently of the others. A corner joined along an edge to terrain of the same kind at the same height cannot be cut. A mountain capping a waterfall keeps square only its corner at the fall's lip; its corners away from the water cut like any other. Source: owner ruling 2026-10-22.
- **EDIT-17** Clicking the inner corner of an L-shaped notch rounds it with a fillet that rises as high as the surrounding walls wrap the corner, and cycling the fillet away returns the cell to what it held before.
- **EDIT-18** Corner cuts and fillets change only the outline drawn: they add and remove no support, so a block's support and an object's footing read the same with or without them.
- **EDIT-19** With Auto Trim set to Bevel or Round, a finished stroke cuts the corners it left exposed and fills the notches it formed, inside the stroke's own undo step; it never changes a corner whose surroundings the stroke left alone, and every automatic cut can be changed afterwards with the corner tool.
- **EDIT-20** When an edit changes the surroundings of a cut corner so that the cut no longer fits, the editor squares or removes it as part of the same edit, and undoing the edit restores the corner as it was.

## Undo and redo

- **EDIT-21** Each gesture is one undo step: a stroke, a shape, a corner click, a placement, a move, a rotation or a delete, together with the repairs it set off, such as roads carried to a new level, corners squared and automatic trims.
- **EDIT-22** Redo brings back exactly what undo took back, one step at a time, and a new edit after an undo clears what could be redone. The part of a stroke the rules withdrew when it ended never reaches redo, and the steps before it stay undoable.
- **EDIT-23** A press cancelled before it ends, by a second touch or a lost pointer, takes back what it had laid and leaves nothing to redo; the strokes before it stay.

## Selection

- **EDIT-24** A click on an object selects it alone, Ctrl+click adds or removes it, Ctrl+drag selects every object whose footprint the band touches, Ctrl+A selects every object on the map including locked ones, and Escape clears the selection.
- **EDIT-25** A selection holds objects only, never terrain, and it stands only while the Hand tool or the object placer is active: arming any other tool clears it.
- **EDIT-26** Holding Ctrl while a terrain brush, the eraser or the corner tool is active selects objects instead of editing and then switches to the Hand tool; a band that catches nothing leaves the tool active and changes nothing.

## Moving, rotating and deleting objects

- **EDIT-27** Dragging a selected object moves it, or the whole selection when several are selected, as one undo step, and each object takes the height of the ground where it lands. A group lands every member or none: a refused move leaves every object where it stood and reports the rule that refused it.
- **EDIT-28** Rotating a selection turns it a quarter turn as one rigid body about the centre of its bounding box, so four turns in either direction bring every member exactly home; a square member that cannot turn is carried round with its facing unchanged.
- **EDIT-29** A rotation is refused whole, with nothing turned, when a member is locked, would land where the rules refuse it, or cannot turn, as a bridge or ramp cannot after placement; a single object whose turned footprint is refused stays as it was.
- **EDIT-30** Deleting a selection removes every unlocked member in one undo step and keeps the locked ones, saying how many it kept; a selection of locked objects only is refused and nothing changes.
- **EDIT-31** Before placing, the rotate shortcut turns the item waiting to be placed, its preview shows at once whether the turned item fits, and the turn carries over to the next placement of the same item; while objects are selected, the shortcut turns the selection instead.

## Locked objects

- **EDIT-32** Outside the planet editor, the landmarks that come with a planet are locked: they can be selected but never moved, turned or removed, and clearing every object leaves them in place. Source: V-LOCK-02.

## Roads, bridges and ramps

- **EDIT-33** Road tiles are laid one per cell on land, never on water, and a tile of a new material replaces the one beneath it. Painting mountain under a road carries the road to its new level when its tile stays level and removes it when the ground under it turns uneven, within the same undo step. Source: V-PLACE-BLOCK.
- **EDIT-34** Placing a solid object over a road removes the road beneath it in the same undo step, unless the item is made to stand on pavement, and a refused placement leaves the road untouched. Source: V-PLACE-OVERLAP.
- **EDIT-35** A bridge placed at a gap snaps across it, taking the position, orientation, length and deck height the gap allows, and a ramp placed at a cliff snaps up it in whichever direction the cliff faces; both may sit on half cells to lie flush with the terrain, and their orientation always comes from the gap or cliff, never from the rotate command. A bridge or ramp dragged to a new place snaps again where it is dropped. Source: V-PLACE-TRAIT.

## Curves

- **EDIT-36** A curve paints nothing until a double-click finishes it; Delete takes back the last anchor, and Escape abandons an unfinished curve without painting anything.
- **EDIT-37** Once a curve is drawn, dragging an anchor or a direction handle lays the whole curve again along the new path: the old path returns to what it held before the curve, mountain never stacks twice where the paths overlap, and each adjustment is its own undo step. Escape, a click elsewhere or a change of shape or surface puts the handles away and keeps the curve.
- **EDIT-38** An adjustment the rules refuse puts both the map and the curve's handles back as they were and leaves no undo step behind.

## Views and shortcuts

- **EDIT-39** The 2D and 3D views run the same tools and the same edits: a gesture in either view makes the same change, refusal and undo step, and a curve being adjusted carries over when the view switches.
- **EDIT-40** A keyboard shortcut runs the same action as its button or tile, with the same result and the same refusal message, and shortcuts do nothing while the user types in a text field.
