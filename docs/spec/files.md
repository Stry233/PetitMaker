# Files

This area covers how a map leaves PetitMaker and comes back: JSON map files, the autosaved session, share images carrying a PetitGlyph code, importing by content, image and JSON export, and erasing local data. Planet files, My planets and the repair every opened map passes belong to the planets area.

## Map files

- **FILE-01** A map exported as JSON opens again as the same map, with the same terrain, objects and planning annotations, and with its title and description when they were included. Source: file format.
- **FILE-02** A map on a built-in planet records only which planet it was made on, while a map on a custom planet carries the whole planet, so it opens without that planet in My planets. Source: file format.
- **FILE-03** The JSON export always includes the map and writes only the optional sections the user chooses: planning annotations, title and description, generation recipe, provenance ledger, step history (all of it or the last steps), editor session, statistics and catalog info. A section the map cannot fill, such as the recipe of terrain that was not fully generated, is unavailable. Source: file format.
- **FILE-04** Opening a JSON export restores the sections it carries, including a step history that can be undone and redone, the locked layers and the cameras; a section that cannot be restored is left out with a warning that names it as the export window does, in the user's language, and the map still opens.
- **FILE-05** A pretty-printed and a compact export of the same map open as the same map. Source: file format.
- **FILE-06** A JSON export carries an integrity code: a file edited after export still opens, with a warning that it may not match the original, and a file without a code opens without that warning.
- **FILE-07** No map file, JSON export, share code or autosave contains the user's provider keys, the sealed record that stores them, or illustration pictures made during the session.
- **FILE-08** A share code carries no undo history, so importing one restores the map as it stood and none of the steps that led to it. Source: file format.

## Versions and damaged files

- **FILE-09** Every map a released version exported (JSON with or without sections, share codes, share images and the autosave record) opens in the current version and reads as that version read it, apart from documented migrations. Source: owner ruling 2026-10-14.
- **FILE-10** A file written in an older format is brought up to the current format as it opens; when its undo history was recorded against an earlier landmark layout, the map opens without that history. Source: file format.
- **FILE-11** A map file or share code written by a newer version is refused with a message asking the user to update; opening a file in a release older than the one that wrote it is not a goal. Source: owner ruling 2026-10-14.
- **FILE-12** A file that is not JSON, is malformed, is cut short anywhere, carries a format version no release wrote, does not fit the planet it names, or names a planet this version neither has nor finds in the file is refused with a message about the file (damaged or not a map file, or made for a planet this version lacks) that never speaks of an image; it never opens as a different map, and the open map stays as it was. Source: file format.
- **FILE-13** An imported file larger than the import limit is refused without being read, with a message giving the limit.
- **FILE-14** An object whose catalog item was retired opens as the item that replaced it, in map files, share codes, autosaves and imported undo history alike. Source: file format.
- **FILE-15** An item withdrawn from the catalog's offers still opens and draws on every map that holds it.

## Autosave and restore

- **FILE-16** The editor autosaves the session in this browser shortly after each edit and at once when the tab is hidden or closed, keeping the map, the 2D and 3D cameras and up to the last 60 undo steps.
- **FILE-17** When an autosaved session exists, the editor offers at start to resume it or start fresh, and resuming restores the map, both cameras and the saved undo steps; the empty starting map never overwrites a session waiting to be restored.
- **FILE-18** An autosave that is damaged or was written by a newer version offers nothing to restore, and one whose undo history is damaged or no longer fits its map restores the map without undo.
- **FILE-19** When browser storage cannot hold a new autosave, the session stored before it is kept rather than lost.
- **FILE-20** An autosaved session on a custom planet restores without that planet in My planets.

## Share images

- **FILE-21** A Share Image carries a visible PetitGlyph code from which import rebuilds the exact map, with its planning annotations whether or not they are drawn, its title and description, and its custom planet; a Plain Image carries no code. Source: file format.
- **FILE-22** Moderate resizing and lossy recompression of a share image do not stop it importing exactly, and an image too large to read at full size is read smaller rather than refused; cropping and rotation are outside what the code promises to survive. Source: file format.
- **FILE-23** A share image either imports exactly the map that was shared or is refused: a damaged code as too damaged, an image without a code as holding no map data, and a code from a newer version with a request to update. It never opens as a different map or on another planet. Source: file format.
- **FILE-24** When a share code cannot hold everything, the export says so: a title and description that do not fit are left out of the code, a map too large for any code or an image size too small for one exports the picture without a code, and a code too dense to survive resizing comes with advice to share the original image or a map file.
- **FILE-25** A share code made against a different object set or built-in planet template still imports, with a warning that the result may differ slightly.
- **FILE-26** A share code may carry the generation recipe of a generated map as a note, and importing a code rebuilds the map as shared without running the generator. Source: file format.
- **FILE-27** When a share image of a hand-made map is imported, its title and description stay as the author wrote them until the importer has changed at least thirty percent of the map, and undoing those changes locks them again.

## Import

- **FILE-28** Import decides what a file is from its content, whatever its name: a map file, a share image, a planet file or a game video. A planet file or video given to Import map, or a map file given to Import planet, is pointed to the window that reads it, and any other file is refused with a message saying it is neither a map file nor a Share Image.
- **FILE-29** An imported map is shown with its picture, title and description before it replaces the open map, and the open map changes only when the user confirms, however the file arrived.

## Export

- **FILE-30** An image export never comes out blank: on a device whose canvas cannot hold the whole composition, the image is composed in tiles or comes out smaller.
- **FILE-31** Before every map image or map file download, Export first included, a notice of the user's responsibilities appears; the download starts only after the notice has been open for a few seconds, scrolled to its end and confirmed, and going back downloads nothing.
- **FILE-32** Exports show only approved text: a custom planning tag appears once the text check approves it and a custom planet's name shows as its default name until approved, while the autosave keeps every tag as entered.
- **FILE-33** Erasing local data in Settings asks for confirmation, removes everything the editor stored in this browser (provider keys, the autosaved session, My planets and all preferences) and restarts the editor as new; an autosave pending at that moment is never written afterwards.
