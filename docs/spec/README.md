# Behaviour specification

This folder states what PetitMaker does, one requirement at a time, in words a player, a reviewer or a contributor can check against the running editor. It is the reference tests prove and changes are reviewed against: a change that alters behaviour edits the requirement in the same change as the code.

## Areas

| File | Covers | Ids |
|---|---|---|
| [rules.md](rules.md) | the game's building rules the editor enforces | rule ids, such as `V-PLACE-DOOR` |
| [editing.md](editing.md) | painting, shapes, layers, corner cuts, selection, moving, undo | `EDIT-01` on |
| [files.md](files.md) | saving, opening, autosave, share images, import and export | `FILE-01` on |
| [planets.md](planets.md) | built-in and custom planets, landmarks, repair of opened maps | `PLAN-01` on |
| [generation.md](generation.md) | Generate, Clear and Smart Build | `GEN-01` on |
| [interface.md](interface.md) | languages, motion, controls, export review, editions | `UI-01` on |
| [assistant.md](assistant.md) | the optional AI assistant | `ASST-01` on |

## Format

Each requirement is one line: `- **<ID>** <one or two sentences>.`, optionally ending with `Source:` and where the requirement comes from (a rule id, a file format, the game, or an owner ruling with its date). A requirement says what can be observed, never how the code achieves it.

Ids are permanent. A requirement that no longer holds stays in place as `- **<ID>** (retired YYYY-MM-DD) <what replaced it>.`. A new numbered requirement is written in its branch as `<PREFIX>-NEW-<NAME>` (`UI-NEW-BRUSH-HINT`) and cited by that name; merging into main gives it the next free number and rewrites its citations, and a placeholder is never pushed unnumbered.

## Tests

A test proves a requirement by opening its title with the id in brackets, `[V-PLACE-DOOR] refuses a house whose door faces a cliff`, or through the `spec(id, title, fn)` helper in `src/__tests__/_support/spec.ts`. A title citing an id this folder lacks fails the suite. `npm run test:spec` runs the tests in `src/__tests__/spec/`; requirements proven elsewhere in the suite count too.
