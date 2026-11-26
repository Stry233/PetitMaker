/**
 * Blueprints on the live editor, the door its callers import: arming one from the library, turning,
 * flipping and placing it, a placed group turned, flipped, moved, copied and taken back whole,
 * framing a region on the region brush (the frame step) and saving it (the save step), the library's verbs, the examples a new library
 * starts with, and moving blueprints in and out as files, with the toasts each raises. Peers import these files directly.
 */
export { adaptedFrom, authorAllowed, knownAuthor, lastBlueprintAuthor, originAmong, originFor, platformAuthor } from './authorship';
export {
  addBlueprintFolder, arrangeBlueprints, deleteBlueprintFolder, deleteBlueprints, deleteSelectedBlueprints, dropBlueprints, exportBlueprints,
  fileBlueprints, moveBlueprints, renameBlueprint, renameBlueprintFolder, setAsideBlueprints, type BlueprintDrop,
} from './filing';
export {
  flipSelectedGroup, moveSelectedGroup, pasteGroupCopy, selectedGroupDrag, selectedGroupName, takeBackSelectedGroup, turnSelectedGroup,
} from './groups';
export { giveBlueprintExamples } from './examples';
export { blueprintFolderVerbs, blueprintVerbs, type BlueprintVerb, type FolderVerb } from './folders';
export { importBlueprintFile } from './import-file';
export {
  __setBlueprintLibrary, blueprintFolders, blueprintLibraryVersion, blueprintOrderShifts, editorBlueprintLibrary, watchBlueprintLibrary,
  watchUnreviewedBlueprints,
} from './library';
export {
  blueprintFolderName, blueprintPlaceholderName, folderNameProblem, newBlueprintPlaceholderName, shownBlueprint, shownBlueprints,
} from './names';
export {
  fitFrameToViewfinder, redrawBlankThumbs, watchBlankThumbs, watchFramedThumbs, type FramedPictures,
} from './pictures';
export {
  armBlueprint, armedBlueprintPlaced, carryBlueprint, flipArmedBlueprint, layBlueprint, placeArmedAt, selectPlacement, turnArmedBlueprint,
  watchArmedBlueprint,
} from './placing';
export {
  defaultSaveFolder, draftOf, fieldsAuthor, saveAllowed, saveBlueprint, saveBlueprintTo, saveFramedBlueprint, saveFramedFields, type SaveFields,
} from './save';
export {
  BLUEPRINT_FRAME_REQUEST, beginBlueprintFrame, confirmBlueprintFrame, escapeBlueprintLibrary, foldBlueprintLibraryForFrame, frameOfSelection, frameRefusal,
  leaveBlueprintFrame, leaveBlueprintSave,
  openBlueprintSave, regionFrame, reopenBlueprintLibrary, saveSelectionAsBlueprint, selectionFrame, takeBlueprintFromLibrary, unfoldBlueprintLibrary,
} from './steps';
export { BLUEPRINT_MAX_SIDE, type CaptureRefusal } from '../../../tools/blueprint';
