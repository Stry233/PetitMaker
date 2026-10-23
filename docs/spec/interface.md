# Interface

This area covers how the editor speaks, moves and responds: its seven languages and their copy, motion and reduced motion, how controls behave and ask for confirmation, map navigation and keyboard shortcuts, the text check, Help, and how the editor keeps working when a part of it, the browser or the device falls short.

## Languages and copy

- **UI-01** The interface and Help are complete in seven languages (Chinese, English, Japanese, Russian, Thai, Indonesian and French): every string exists in each, none is blank, and each carries the same placeholders as English.
- **UI-02** On a first visit the interface language follows the browser's language when it is one of the seven, and English otherwise; a chosen language is remembered and applied before the editor first appears.
- **UI-03** Switching the language updates every visible text at once, including notices already on screen, without a reload.
- **UI-04** Help and the tour name each control with the exact label that control shows in the same language.
- **UI-05** Copy in every language reads as plain, native, professional writing; no interface text uses em dashes or dot separators, and only error toasts take the form of a category followed by a reason.
- **UI-06** Counts take the grammatical form each language needs, numbers of five or more digits are grouped the local way, and seeds always show exactly as typed.

## Motion

- **UI-07** Every state change in the interface animates. Source: owner ruling 2026-08-29.
- **UI-08** Every animation respects reduced motion: Settings offers System, Reduced and Full, System follows the device setting, and under reduced motion decorative motion stops while progress and errors step straight to their new state. Source: owner ruling 2026-08-29.

## Controls and confirmations

- **UI-09** A control never changes itself to ask for confirmation; a confirmation unrolls as its own surface from the control, or the action runs at once and can be undone. Source: owner ruling 2026-09-28.
- **UI-10** Controls keep their positions when state changes: an unavailable control dims in place instead of disappearing, and a control two tools share stays where it is when the user switches between them.
- **UI-11** Labels never shrink to fit; a label that lacks room wraps, scrolls or ends in an ellipsis with its full text available.
- **UI-12** Escape closes only the surface in front, and a press outside a dismissible surface closes it without also acting on what lies beneath.

## Map navigation and shortcuts

- **UI-13** The mouse wheel over the map zooms it, in steps for a mouse wheel and smoothly for a trackpad pinch or a two-finger touch. Source: owner ruling 2026-08-29.
- **UI-14** The wheel over a row of controls that overflows scrolls that row and never reaches the map; over a row that fits, the map receives it.
- **UI-15** Every keyboard shortcut can be rebound, and binding a key already in use moves it from its previous command, which is left unbound.
- **UI-16** Map shortcuts do nothing while a window is open.

## Text review

- **UI-17** The map title, description, footer and Letter text reach a picture, preview, generation or export only after the text check approves that exact text; an edit, a pending check, a refusal or a check that could not finish keeps it out.
- **UI-18** When text cannot be approved, the user can export without added text, which leaves out the title and description and uses the default footer while keeping the draft for later editing.
- **UI-19** The text check runs on the device and never uploads the text, and neither the submitted text nor its verdict is saved.
- **UI-20** A confirmed finding from the on-device check of the map picture disables the export controls, while a check that fails or times out never counts as a finding.

## Help

- **UI-21** Every window has a Help topic, and in What's this? mode picking any control or window opens Help at its topic, while picking the bare map opens the topic for the tool in hand.

## Resilience, devices and editions

- **UI-22** When one part of the interface fails to render, it shows a notice with a retry in its place while the map and every other part keep working; a part that fails to download offers a reload.
- **UI-23** A browser that cannot run the editor shows a notice in the visitor's language stating the requirement and offering download links, instead of a blank page.
- **UI-24** On a device without WebGL2 the editor works in full in 2D: the 3D switch shows as unavailable, the tour leaves out its 3D steps and exports leave out 3D shots.
- **UI-25** The Lite edition runs fully offline from one package, with no network requests, external links or background workers, and keeps the shared editor, map rules, seven languages, and Planet and Maze generation. It leaves out the assistant, Letter, Picture and illustration features.
