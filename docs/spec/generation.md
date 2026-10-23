# Generation

This area covers what Generate builds (designed planets, mazes, and picture and text stencils), how its recipes reproduce a map, how a painted region, the map rules and the regional load bound it, how undo, cancel and Clear take it back, and what Smart Build's actions do.

## Generate

- **GEN-01** Generate offers four kinds: Planet designs a whole planet, Maze lays a walled maze, Letter writes text in terrain or objects, and Picture lays an image in terrain or objects.
- **GEN-02** Each recipe card shows a picture of exactly the map that clicking it produces, and building card pictures, drawing a new batch or rerolling never changes the map being edited.
- **GEN-03** Generating with the same seed and settings on the same planet and catalog produces the same map every time, whether it is built in the background or on the page. A Smart Build action with the same seed and settings builds the same result.
- **GEN-04** A share code of a whole-planet generation carries its seed and settings, so the planet can be regenerated from it; a whole-planet Picture or Letter run records its seed and layer ceiling the same way, while a region-scoped run, a Letter laid by brush and an undone generation carry no recipe.

## Regions, rules and landmarks

- **GEN-05** With a region painted, a generation changes only cells inside the region and leaves everything outside it exactly as it was, and the region stays painted after the run. A planet is still designed as a whole, so a small region may receive no change.
- **GEN-06** Every generated map, on built-in and custom planets alike, satisfies every map rule, and generation never builds over the landmark or paints the ground under it. Source: the game.
- **GEN-07** A generated maze can be entered from outside and reaches every passage, and it leaves exactly one route between its way in and its destination, with no way around the maze.

## Undo, cancel and Clear

- **GEN-08** Each generation is one undo step: undoing it restores the map and the recipe that stood before, and redo puts the run back. Each recipe card clicked is its own undo step.
- **GEN-09** A generation cancelled before it lands, including by closing the shelf, leaves the map, its undo history and the previous generation untouched.
- **GEN-10** Clear generated removes generated content, Smart Build results included, within the last run's scope (the whole planet when no region was painted), and keeps the landmark and everything the user placed or painted by hand. It is one undo step, and undoing it gives the recipe back.
- **GEN-11** Opening or loading a map forgets the last generation's scope, so Clear generated has nothing to take back on that map until it is generated again.

## Pictures and text

- **GEN-12** A Picture or Letter is never resized to fit the regional load: when load is short, it keeps its size, position and materials and places objects more sparsely, keeping its outline, corners and fine details first.
- **GEN-13** When the smallest readable version of a Picture or Letter cannot fit the regional load, the run is refused with a notice, and the map, its undo history and the previous generation stay unchanged.
- **GEN-14** A Letter too long for its region says so on its card and generates nothing; the same word builds once the region has room for it.
- **GEN-15** Letter counts characters as the reader sees them, so an emoji sequence or an accented letter is one character, and pressing Enter while an input method is still composing does not start a run.
- **GEN-16** After a Picture or Letter run the editor says when the run was refused, laid nothing, was made sparser or left cells out, and why; it says nothing when the result was laid whole.

## Smart Build

- **GEN-17** Each Smart Build action is one undo step, and holding a planting spray down is one undo step for the whole hold; adjusting a river or a drawn road afterwards adds its own undo step.
- **GEN-18** Smart Build previews show exactly the cells an action would change and what it would replace, without writing anything to the map. Rivers and drawn roads preview while dragging, build only on release, and Escape cancels them before release.
- **GEN-19** A Smart Build planting keeps every plant that fits when others are refused, while a river or a drawn road lands whole or not at all.
- **GEN-20** With a region painted, Smart Build changes only cells inside it, a planting included down to every footprint it lays, and no Smart Build action paints a locked layer.
- **GEN-21** A Smart Build action that finds nothing to build, or fails, leaves the map unchanged, adds no undo step and says why, and the next action works normally.

## Background work

- **GEN-22** If background workers cannot start or stop working, Generate, its card pictures and Smart Build keep working on the page itself, and a single failed background job is answered on the page without stopping later ones.
