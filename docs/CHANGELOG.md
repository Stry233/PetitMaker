# Changelog

All notable changes to PetitMaker are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.28] - 2026-08-11

### Added

- **An island from a letter, or from a picture.** Letter and Picture join the Generate shelf: hand one a character or an image and it builds that shape as an island, down to reading each corner's trim off the source's own outline. The figure can be grabbed and moved inside its region before it builds, and a shape that cannot fit the region says so instead of spilling.
- **The painted region can be picked up and carried whole**, and in 3D it drapes over the ground it is lying on.

### Fixed

- **Falling water refuses the corner trim.** A waterfall's face locks as one piece, so an edge cut can no longer nick the fall at any height.
- **The placement ghost reads against a cliff.** The 3D view draws it yellow, so it no longer disappears into the green of a slope behind it.

## [0.5.550] - 2026-08-11

### Added

- **A smart build shelf, where one press lays a whole thing.** Choose what to build and press the map: a terraced hill, a stream that finds its way down to water, a road, or a planting. Each shows a preview of what it would build before you commit, and holding the press grows it. A planting reads what it is standing beside, so a bed appears against a building and a border along a road, and holding it lets the stand mature.
- **Roads you can route.** Press a point and then another to connect them, and the shelf offers the ways it found and what each would cost. Press again for a different layout of the same island rather than a second one piled on the first. A whole-island press paves the network and ends its streets at the doors.
- **A way in and a way out of a maze.** Turn the marks on and drag them where you want them; every candidate is built with them, and the route between them can be shown, paved as real road.
- **The eraser takes back a rectangle or a circle**, beside the dab it has always had. Press at one corner, drag the figure out, and the whole of it goes on release; hold Shift for a square or a round circle. It is one undo step.
- **Resuming a session restores what you can still undo**, up to the last sixty steps, alongside the map and the camera.
- **Ramps and bridges sit on the half grid**, so a crossing lands where the gap actually is rather than a cell away from it.
- **The object shelf forgives a search.** Two words at once, a misspelling, an item's other names, and its colour all find it.
- **Generate offers candidates you can see.** Each card is a photograph of the map that recipe builds, and clicking one is the confirmation, with no second step.

### Changed

- **A new interface, in the game's own style.** The tools are five mode blocks along the top with a bar for whichever one is chosen, the layers and the view controls stand in a column at the right, and the windows are reached from one menu. It is laid out to fit a laptop, and it scales down rather than covering the map on a smaller screen.
- **A new default keymap, matched to the game's controls.** The terrain tools sit on the digit row in the order the bar shows them, and WASD pans. Every command is still rebindable, and the previous layout remains as a preset.
- **Save and share is one window** with three sections: keep working, share a picture, or read the build checklist.
- **The 3D view opens square on**, the way the 2D view does, and it opens sooner: its scene is fetched in the background while you work in 2D. Touching the camera during the opening fly-in lands the view immediately rather than ignoring you until it finishes.
- **Editing is quicker on a full map**, most visibly while a large selection is standing. The support check behind every stroke was reduced to about a fifth of its cost, and the 3D water now moves on the graphics card instead of being recomputed every frame.
- **A painted region reads clearly in 3D**, drawn in white rather than green over green.

### Fixed

- **The brush preview promises what the stroke will do.** It stands on the surface it hovers, trims the corners the stroke will trim, and draws a placement as one body rather than a stack of parts.
- **Water follows the ground it crosses**, unless you pinned a layer yourself.
- **A cut corner where mountain meets water opens onto the mountain**, so the junction reads as one line, and two shores meeting at a point now weld.
- **A saved file with a half-cell crossing no longer loses its undo history** on import.
- **The recipe field on the Generate panel is a line you write on.** The blank keeps its place and its length as the number grows, and its caret matches the digits beside it.
- **A road's rounded corner could keep its old shape** after a generation or a smart-build press, until something else nearby was redrawn.
- **A failing generator run no longer moves every later one onto the main thread**, which had made each press after it slower for the rest of the session.
- **The digit shortcuts fire by their physical keys**, whatever the keyboard layout types.
- **The cursor answers for the tool you have arrived at**, not the one you just left.

## [0.4.149] - 2026-08-02

### Added

- **A guided tour on first launch.** It covers moving the map, where the menu is, reading the height of a block, and switching between the 2D and 3D views. It can be skipped, and reopened from Settings under Getting started.
- **The curve tool passes through the points you place.** Click to add a point, drag to move one, double-click to finish. The points remain after the curve is drawn, each with a handle either side for adjusting the path; hold Alt to move one side independently. Each adjustment is a single undo step, and Escape dismisses the handles.
- **The brush preview shows the auto-trimmed result.** With auto-trim on, the preview rounds the corners the stroke will round, in every shape tool; the freehand brush trims as it draws.
- **Nineteen additional flower colours**, bringing the catalog to 81 placeable items.
- **A quick-hints panel beside the zoom buttons.** It lists the few most useful actions for what you are doing right now: how to move the map in 2D or 3D, the curve tool's handles, what a selection can do, and the tricks each brush hides. The keys it shows follow your own rebindings, a small button on the card collapses it to its three best lines, another closes it, and Settings chooses Full, Concise or Off.
- **Keyboard shortcuts for both exports.** Ctrl+S saves the JSON file, Ctrl+P exports the share image, and Ctrl+Alt+N starts a new map, as Ctrl+N is reserved by the browser. The keyboard page lists and rebinds Alt combinations alongside Ctrl and Shift, and `m` shows or hides the menu.
- **A confirmation before starting a new map** when the current one has not been exported.
- **Bridge and ramp icons indicate orientation** in the 2D view: a bridge's icon rotates with the bridge, and a ramp's points from its low end to its high end.
- **Camera inertia in the 3D views**, and one held-key pan shared by both, at two speeds: double-tap a direction for the faster one, hold Shift for the slower one.
- **Support for phone-sized screens**, a notice when the app is opened inside another application's in-app browser, where some features are unavailable, and a beta marker.
- **The AI agent is confined to a painted region**, as the generator already was.
- **Chinese versions of the changelog and the asset licences**, in the app and in the repository.

### Changed

- **A new code format for share images**, which carries less data and reads back the same map. The code is named PetitGlyph, sits at the page margin, and is shorter for the same map. Images exported by earlier builds can no longer be imported; re-export any map you intend to keep sharing. JSON save files are unaffected.
- **Clear reverses the last generation instead of emptying the map.** It is limited to the region that generation was given, and leaves manually placed content in place.
- **Objects can no longer stand on a road.** Placing an object on a paved cell removes the road under it, which matches the game's rule.
- **Browser zoom no longer affects the 2D map.** Zooming the page does not rescale or shift the map, and the view no longer jumps on the next pan.

### Fixed

- **Auto-trim could leave an empty cell** in terrain that had just been painted, reported afterwards as a floating-block violation.
- **A shape crossing ground it may not build on placed nothing at all.** Rectangle, circle, line and curve now place the permitted part of the shape and skip the rest.
- **The brush preview could modify the map it was previewing**, removing blocks that were already there.
- **Generating into a region removed placements in a previously generated region**, and the newly generated region could appear empty.
- **Locked layers flickered** in the layer panel during a brush drag.
- **The Generate panel's mode buttons shifted** when the window was resized.
- **The page title showed two languages** until the app finished loading.
- **Clicking the plaza now reports why the action was refused**, rather than doing nothing.
- **A share image that predates a catalog addition now reports why the import failed.**
- **Modifier-key hints appear when the key is pressed**, rather than on the next pointer movement.
- **Dragging the 2D map with the hand tool** could move it far beyond the pointer.
- **Rotating an item with the comma and period keys before placement** now updates the preview immediately.
- **The device-rotation notice** uses an icon that reads as a rotation.

## [0.3.2] - 2026-07-30

_No user-facing changes._

## [0.2.71] - 2026-07-30

### Added

- **A guided tour the first time you open the editor.** It walks through moving the map, where the menu lives, how to read the height of a block, and how to switch between the 2D and 3D views. Skip it whenever you like, and open it again from Settings under Getting started.
- **The changelog and the asset licences now read in Chinese**, in the app and in the repository, alongside the English ones.

### Changed

- **Share images use a new code format**, which carries less and reads the same. A picture made by an earlier build no longer imports. Export a fresh picture of any map you want to keep sharing. Saved JSON files are unaffected.

### Fixed

- **Dragging the 2D map with the hand tool** could send it sliding far past the pointer instead of following it.
- **Turning an item with the comma and period keys before placing it** now turns the preview straight away, instead of waiting for the next mouse movement.
- **The rotate-your-device notice** shows an icon that reads as a rotation.

## [0.1.1645] - 2026-07-30

PetitMaker is a map planner for *Petit Planet* that runs in your browser. Plan an island here, then build it in the game. Nothing is uploaded and there is no account.

### Added

- **Two editing views of one map.** 2D and 3D edit the same grid, and every tool works in either one. Switch mid-edit and you keep the map, the selection and the undo history. The 3D view adds animated water, soft shadows, and a model for every placed item.
- **Terrain painting that checks itself.** Free brush, line, curve, rectangle, circle, and a brush-size dial. A stroke the game would not allow is undone on the spot, and the editor names the rule it broke.
- **Items checked before they land.** An item that cannot stand where you are pointing is refused rather than placed and then taken back. A bridge snaps into place once it has two flat banks of equal height.
- **A catalog of 62 items**: cabins, facilities, bridges, ramps, trees and flowers, plus two road styles you paint like a brush. Items snap to the grid, rotate on click, and drag to a new spot.
- **Edge-cut corner trimming.** Trim mountain corners one click at a time, or let auto-trim do it as you paint, bevelled or rounded.
- **Eight elevation layers**, each with its own visibility and lock switch, and an eraser that takes one layer per pass.
- **Two generators from one recipe number.** Random designs a settled island: themed neighbourhoods, terraces you can climb, a river stepping down to the sea, bridges where two banks match, and roads out to every home. Maze fills the buildable ground with corridors instead. The same number always produces the same map, so a number you like is one you can share.
- **A naturalness dial** that runs the same recipe anywhere from rectilinear to organic, and a maximum-height limit.
- **Share images that are the map.** A map exports as a picture carrying a visible PetitGlyph band. Drop that picture back in and you get the island back, cell for cell. It verifies itself on import and tells you if the image is too damaged to read.
- **JSON save and load**, a sectioned JSON export, and a save format that migrates older files forward.
- **Autosave** into your own browser, with a restore prompt when you come back.
- **An optional AI agent.** Bring your own key, kept encrypted on your device, for any of nine providers including any OpenAI-compatible endpoint. It writes a plan first, works through the same rules your brush obeys, and leaves each stage as a point you can rewind to. You choose how often it asks before acting.
- **An interactive shortcuts page.** Every command on a rendered keyboard, with modifier layers and the keypad. Click a key to see what it does, record a new combination to rebind it, or search for a command that has no key yet. Bindings persist, and export and import as JSON.
- **Seven interface languages**: Chinese, English, Japanese, Russian, Thai, Indonesian and French.

<!-- Version-compare links (…/compare/vN...HEAD) start with the second release; the first has no earlier version to compare against. -->
