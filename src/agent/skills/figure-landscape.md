FIGURE LANDSCAPE — a picture or word drawn INTO the ground: the expert maps carry a heart lake, a paw pond, and a whole "I ♥ ..." banner flooded into a wall top. A figure is the strongest single move a map can make, and the methodology lists it as its own place type (文字/图案景观). One figure is a signature; three are wallpaper.

THE PARAMETRIC SHAPES FIRST: draw_figure lays a heart, ring or crescent as ground water with TRUE symmetry in one call (size 8-48 across), and ringId plants a single-species ring around the outline — use it for every figure it covers, and compose cells by hand only for what it cannot draw (letters, custom marks).

THE THREE CANVASES
- GROUND WATER (easiest): paint_terrain water elevation 0 with shape cells on open grass — no caps needed, any outline works. Best for hearts, rings, crescents, paws at 150-400 cells.
- FLOODED TERRACE (the banner): build a flat bench (paint_terrain mountain, elev 2-4), then paint the figure as water AT the bench's elevation, keeping every figure cell 1+ cell inside the bench edge — the bench itself is the containment, and the untouched bench cells are the STROKES. Letters read as dry bench standing in water: flood the REGION and leave the letters, not the reverse. This is how the expert wall banner works.
- FLOWER FIGURE: scatter_objects one species, spacing 0, over composed cells — a colored figure on lawn. Use for small marks (a heart of roses by a door), not billboards.

DRAWING RULES (cells are pixels)
- Compose on graph logic: pick the bounding rect first (a readable letter needs 5x7 cells minimum, a heart reads from 9x8 up), write the cell list row by row, then ONE paint_terrain shape cells call per figure. For text, 1-cell stroke width at 5x7, 2-cell strokes from 10x14 up; leave 2+ blank columns between letters.
- SITE IT FOR THE VIEW: a figure is only worth building where it is SEEN — beside the plaza, along the main street, filling a terrace the low ground looks up at. Orient the figure toward the viewpoint (text reads from the south on a north wall).
- Frame it: a 2-wide paved rim or a single-species edging around the figure's rect separates it from ordinary ground. Inside the frame, nothing else — a figure with decorations on it stops reading.
- verify with view_map after painting: token grids show the shape, but only the picture tells you whether it READS. Expect one round of cell-level touch-up (paint_terrain / erase_terrain on the miswritten cells).

FAILURE MODES
- Free-handing letter cells without planning the rect: strokes drift a row and the word breaks. Write the full cell list before the call.
- A figure at elevation on a slope: the containment fails and the call REVERTS. The canvas bench must be ONE flat elevation first.
- Competing figures: the map's ONE primary figure gets the size and the framing; any second figure is small, far away, and echoes the first (the heart lake and the paw pond are a rhyme, not rivals).

DONE BAR: the figure names itself at a glance in view_map, stands framed with empty ground inside the frame, and faces the walk that looks at it.
