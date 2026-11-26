/** The strip's folder names: All, then each folder in the order it was made; a folder's tab opens its
 *  own menu on a right press or a hold. */
import { useT } from '../../../../i18n/context';
import { ShelfTabs } from '../ShelfTabs';
import { folderPiece, folderRide, usePieces, type BlueprintShelfModel } from './use-blueprint-shelf';
import { BLUEPRINT_FOLDER_ATTR } from './use-blueprint-carry';
import { useFolderPress } from './blueprint-asks';

/** A tab's id: All's, or a folder's name behind a prefix no id of All can take. */
const ALL = 'all';
const idOf = (folder: string | null): string => (folder === null ? ALL : `folder:${folder}`);

export function FolderTabs({ model }: { model: BlueprintShelfModel }) {
  const t = useT();
  const piece = usePieces();
  const press = useFolderPress();
  return (
    <ShelfTabs
      label={t('mode.blueprint')}
      tabs={[null, ...model.folders].map((f) => ({
        id: idOf(f), label: f === null ? t('blueprint.all') : model.folderName(f), piece: piece(folderPiece(f), 'fit', folderRide(f)),
        // A card carried onto a folder's tab is filed there; All is no folder to file in.
        ...(f === null ? {} : { attrs: { [BLUEPRINT_FOLDER_ATTR]: f, ...press(f) }, target: model.carry.dropFolder === f }),
      }))}
      active={model.searching ? null : idOf(model.folder)}
      onSelect={(id) => model.setFolder(id === ALL ? null : id.slice('folder:'.length))}
    />
  );
}
