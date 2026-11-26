/** The blueprint file door: the record shape and the reader and writer of a blueprint file. */
export {
  BLUEPRINT_FILE_FORMAT, BLUEPRINT_NAME_MAX, blueprintPartText, builtInFolderId, builtInFolderOf, EXAMPLES_FOLDER, folderReviewText, MY_FOLDER,
  type BlueprintRecord, type BlueprintTextPart, type BuiltInFolder,
} from './format';
export { encodeBlueprints, decodeBlueprints, admitBlueprintRecord } from './codec';
export { blueprintThumbPreview, blueprintThumbs, staged as stageBlueprint, type Staged, type ThumbView } from './thumbs';
