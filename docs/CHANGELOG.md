# Changelog

All notable changes to PetitMaker are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
