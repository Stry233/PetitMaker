# Planets

This area covers the planets a map is built on: the game's built-in planets and their landmarks, custom planets and the planet editor that shapes them, My planets, carrying a build to another planet, the repair a map gets as it opens, and reading a planet's ground from a game recording.

## Built-in planets and landmarks

- **PLAN-01** The editor offers the game's built-in planets, Hexia and Taffeh, and a new map on one opens with only the planet's own ground, shore, terrain and landmarks. Source: the game.
- **PLAN-02** Every map lays its planet's landmarks, the Neighbor Center and the Station, from the planet itself and locks them; a map file never places a landmark, so it always stands where its planet puts it. Source: the game.
- **PLAN-03** Outside the planet editor a landmark can be selected but never moved, turned or removed, and nothing can be built over it; deleting a selection that holds it keeps it and says so. Source: the game.
- **PLAN-04** A landmark carries no height of its own: it stands on whatever ground lies under it and follows that ground, which on the built-in planets is a layer-1 mountain the planet lays under the Neighbor Center as ordinary terrain, and a height a file records is ignored. Source: owner ruling 2026-10-09.
- **PLAN-05** Each landmark has the same footprint on every planet, built-in or custom; a planet stored with a landmark at an earlier footprint opens with it regrown about its centre as a new planet, and maps saved on it still open. Source: owner ruling 2026-10-13.

## Custom planets

- **PLAN-06** A custom planet's identity follows its shape (size, ground, ponds, terrain and landmarks, never its name): the same shape has one identity everywhere, any edit makes a new planet, and a planet reopened and saved unchanged keeps its identity.
- **PLAN-07** A custom planet is at most 16 chunks on each side, is saved cropped to the whole chunks its ground and landmarks cover, and may have no Neighbor Center or Station.
- **PLAN-08** A planet from a planet file, a map file or a share code is checked before use, and one that is malformed, larger than a planet can be, or whose content does not match its identity is refused. Source: file format.

## The planet editor

- **PLAN-09** New planet opens the planet editor on an empty sea and Edit shape opens a saved planet; the map that was open is set aside and comes back unchanged on leaving, with its undo history, selection, layers and cameras.
- **PLAN-10** The planet editor paints flat ground, grass or sand, onto the sea and erases it back to sea; a planet stored with mountains keeps them.
- **PLAN-11** Water painted on the planet's grass makes a pond, which keeps grass under it, gets no shore around it and travels with the planet.
- **PLAN-12** The shore is the one-cell rim of sea and sand around the grass, derived and never painted: it follows every ground edit, undo and redo, and sand painted beside grass lies under the rim and shows again when the grass goes. Source: the game.
- **PLAN-13** The Neighbor Center and the Station are placed from the planet editor's shelf, at most one of each, and placing either lays no terrain. Source: owner ruling 2026-10-09.
- **PLAN-14** The Neighbor Center stands wholly on grass, moves in half-cell steps and turns in quarter turns, and a placement, move or turn that would leave the grass is refused with the landmark left as it was. Source: the game.
- **PLAN-15** The Station starts at the shore and reaches out over the sea, moves in half-cell steps and keeps its facing, and it is refused on grass or out at sea. Source: the game.
- **PLAN-16** In the planet editor the ground under a placed landmark cannot be changed.
- **PLAN-17** Done saves the planet to My planets under the name given, replacing the planet being edited or as a copy; it is unavailable while the planet has no ground, and a save the browser cannot hold is reported with the planet editor left open.
- **PLAN-18** Back leaves at once when nothing was drawn, and asks before discarding a drawn planet or an unsaved planet read from a recording.

## My planets

- **PLAN-19** My planets lists the user's custom planets beside the built-in planets, marks the planet the open map stands on, and lets each saved planet be renamed, duplicated, deleted after confirmation, edited, or exported as a planet file.
- **PLAN-20** Importing a planet file adds it to My planets and chooses it, a planet whose shape My planets already holds is chosen rather than added twice, and a file that is not a planet file is refused with a message.
- **PLAN-21** A custom planet joins My planets when a map on it is opened or a session on it is resumed, never when a file is only inspected or a restore is declined, and the map still opens when My planets cannot store its planet.
- **PLAN-22** A typed planet name passes the name check before the planet is saved under it; a name that arrives with a file or another person's map shows as the planet's default name until the check approves it, and a refused name is replaced for good.

## Changing planet

- **PLAN-23** When the open map holds a build and another planet is chosen, the editor offers to bring the build along, which is the default, or start fresh; it switches at once when there is nothing to carry, and offers Export first whenever starting fresh would discard edits that were not exported.
- **PLAN-24** A carried build is laid over the new planet by lining up the two planets' Neighbor Centers, or a planet's middle where it has none; the new planet keeps its own landmarks and ground, and its own mountains stay except where the build overlaps them.
- **PLAN-25** Before the change a preview shows how the build will arrive and marks what will not fit, the result matches the preview, and on arrival the editor reports the ground and pieces left behind.
- **PLAN-26** Plan notes move with the build by the same offset and stay hidden or locked as they were, the new planet opens with a fresh undo history, and the same build on the same planet always arrives the same way.

## Repair on opening

- **PLAN-27** Every map that opens, from a file, a share image, a resumed session or a carried build, ends legal under the current rules, violations it already had included: whatever stands under a landmark or breaks a rule is moved, taken off or given back to the planet's own terrain. The regional load limit is not one of these rules, so a map over it is not changed for it. Source: owner ruling 2026-10-16.
- **PLAN-28** When opening would change the map, the editor first asks, with the open map still in place, whether to repair automatically or by hand, to export first, or to cancel; a map that needs no change opens without asking. Source: owner ruling 2026-10-16.
- **PLAN-29** Automatic repair lands as one undo step, moves each refused object to a legal place where one exists, leaves off any object with no legal place, and yields a map every rule accepts.
- **PLAN-30** Repair by hand opens the map with the objects where the file had them, lets only the objects against the rules be pressed, flags each until it stands legally, offers to repair the rest automatically, and finishes only on a map every rule accepts.
- **PLAN-31** Export first downloads the map exactly as it was loaded (the opened file itself, the stored session, or the build as carried) and leaves the choice open. Cancel, in the choice or during the hand repair, leaves the open map, its undo history, cameras and autosave as they were.

## Planets from a game recording

- **PLAN-32** Import planet reads the planet's ground from a screen recording of the game's Map view, taken at maximum zoom with the Regional load display on, in MP4, MOV, MKV or WebM; the recording is read on the device and stays there.
- **PLAN-33** A recording it cannot read is refused with the reason and a way to fix it: no Map view, not at maximum zoom, a zoom change, no chunk lines, a camera too fast, too blurry, too little of the planet, an area larger than a planet, more than one import can read, an unreadable game window, no grass, or a file the browser cannot play. A device too busy to keep up is reported as such, not as a fault in the recording.
- **PLAN-34** The planet it reads opens in the planet editor as an unsaved new planet, with its sea, sand and grass cell by cell and the landmarks it found; objects, mountains, water and anything the recording did not show are left to the user.
- **PLAN-35** The result states its doubts: the cells worth a second look can be shown, a recording that covers only part of the coast still makes a planet and says how much of the coast it covered, and a landmark it cannot place is named and left for the user to place without refusing the recording.
