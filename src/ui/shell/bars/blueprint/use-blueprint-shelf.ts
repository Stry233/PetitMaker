/**
 * What every shape of the Blueprint strip and its explorer shows: the library as the store's view of
 * it lays it out (`state/blueprint-library-view.ts`), the query typed, which picture each card shows,
 * and the verbs a press runs.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { pressCommand, runCommand } from '../../../../editor/commands/run';
import {
  blueprintFolderName, blueprintFolders, blueprintLibraryVersion, deleteBlueprintFolder,
  deleteBlueprints, foldBlueprintLibraryForFrame, reopenBlueprintLibrary,
  shownBlueprints, unfoldBlueprintLibrary, watchBlueprintLibrary,
} from '../../../../editor/editing/blueprint';
import type { BlueprintRecord } from '../../../../io/blueprint';
import { explorerUnfolded, type BlueprintStep, type BlueprintUi, type BlueprintUiChoice } from '../../../../state/slices/blueprint';
import { libraryView, menuButtonOn, selectionShown, type ExportScope } from '../../../../state/blueprint-library-view';
import { useEditorStore } from '../../../../state/store';
import { localeTag } from '../../../../i18n/locale-info';
import { useLocale, useT } from '../../../../i18n/context';
import { useVersioned } from '../../../primitives/use-versioned';
import { MORPH_GUIDE_ATTR, MORPH_PIECE_ATTR, MORPH_SHAPE_ATTR, rideAttrs, type MorphShape, type Ride } from '../../../primitives/morph';
import { useEffectEvent } from '../../../primitives/use-effect-event';
import { useTouchMode } from '../../../design/input-mode';
import { useUiPreview, useUiPreviewPose } from '../../../design/preview';
import { seconds } from '../../../design/motion';
import type { MotionId } from '../../../design/motion/registry';
import { usePx } from '../../../design/scale';
import { useFrameLayout } from '../../frame-layout';
import { useFrameZoom } from '../../use-frame-zoom';
import { useRunCommand } from '../../use-shell-commands';
import { stripCard } from './BlueprintCard';
import { useBlueprintCarry, type BlueprintCarry } from './use-blueprint-carry';

export interface BlueprintShelfModel {
  folders: readonly string[];
  /** The name `folder` shows: the app's own folder's in the interface language, any other as typed. */
  folderName: (folder: string) => string;
  /** How many blueprints `folder` holds, every one for null. */
  countOf: (folder: string | null) => number;
  /** The folder tab open, or null for All; none while searching. */
  folder: string | null;
  setFolder: (folder: string | null) => void;
  query: string;
  setQuery: (query: string) => void;
  searching: boolean;
  /** The cards the folder or the search leaves, in the library's own order, with their texts as the
   *  page may show them. */
  records: readonly BlueprintRecord[];
  /** The same cards in the details list's order: its column sort, or the library's own. */
  listed: readonly BlueprintRecord[];
  /** The ids of the cards in the order the explorer's view shows them. */
  order: readonly string[];
  /** Whether the cards show their 3D picture, as the map's view does. */
  lifted: boolean;
  /** The armed blueprint as shown, or null. */
  armed: BlueprintRecord | null;
  /** Arms `id`, or disarms it when it is the armed one. */
  toggle: (id: string) => void;
  /** Opens the frame step for a new blueprint; pressed in the open explorer, it folds the explorer
   *  first and opens the step once the fold has run its length (`useAfterMotion`). */
  newBlueprint: () => void;
  /** Adds a folder and opens it. */
  addFolder: (name: string) => void;
  rename: (id: string, name: string) => void;
  move: (ids: readonly string[], folder: string | null) => void;
  /** What the head's Export exports now: the explorer's selection, else what the search found, else
   *  the open folder, else the whole library. */
  exportScope: ExportScope;
  /** Deletes the blueprints `ids` as a drop on the delete target does, with the same Undo. */
  remove: (ids: readonly string[]) => void;
  /** Renames a folder with its blueprints; whether it was renamed (a blank or in-use name is not taken). */
  renameFolder: (from: string, to: string) => Promise<boolean>;
  /** Removes a folder and every blueprint in it. */
  removeFolder: (folder: string) => void;
  /** Whether the strip stands unfolded into the explorer. */
  unfolded: boolean;
  /** Unfolds or folds the explorer, with `choice` for the view as well. */
  unfold: (unfolded: boolean, choice?: BlueprintUiChoice) => void;
  /** Folds the explorer and arms `id`. */
  take: (id: string) => void;
  /** The ids selected in the explorer, in the order the cards show. */
  selected: readonly string[];
  /** The selection as the store holds it now, for presses landing before the next render. */
  selectedNow: () => readonly string[];
  select: (ids: readonly string[]) => void;
  /** The blueprint whose card or row wears the menu button, or null (`menuButtonOn`). */
  menuOn: string | null;
  view: BlueprintUi['view'];
  setView: (view: BlueprintUi['view']) => void;
  sort: BlueprintUi['sort'];
  setSort: (sort: BlueprintUi['sort']) => void;
  /** Whether a finger picks several cards with tick circles. */
  picking: boolean;
  /** Turns picking on, or off with nothing picked. */
  setPicking: (picking: boolean) => void;
  /** Cards carried to the map or into a folder. */
  carry: BlueprintCarry;
  /** The explorer stands mounted out of sight, about to unfold (a pointer on the unfold square or a held
   *  handle), so the unfolding starts on the next frame rather than after it mounts. */
  warm: boolean;
  /** Mounts the folded explorer out of sight, or lets it go. */
  setWarm: (warm: boolean) => void;
}

/** The blueprint library's version, which every change to its records or folders moves on. */
export function useBlueprintLibraryVersion(): number {
  return useSyncExternalStore(watchBlueprintLibrary, blueprintLibraryVersion);
}

/** The library as shown, read again whenever it changes and whenever the interface language does,
 *  which the app's own names follow. */
function useLibrary(): { all: readonly BlueprintRecord[]; folders: readonly string[] } {
  const version = useBlueprintLibraryVersion();
  const t = useT();
  return useVersioned(() => ({ all: shownBlueprints(), folders: blueprintFolders() }), [version, t]);
}

/** Runs `then(id)` once `motion` has run its length since step `id` stood, at once where `still`: the
 *  one clock both legs of the explorer's frame handover wait on, the fold before the frame step takes
 *  the bar's place and the bar's return before the explorer unfolds again. */
function useAfterMotion(id: number | null, motion: MotionId, still: boolean, then: (id: number) => void): void {
  const run = useEffectEvent(then);
  useEffect(() => {
    if (id === null) return undefined;
    if (still) { run(id); return undefined; }
    const later = setTimeout(() => run(id), seconds(motion) * 1000);
    return () => clearTimeout(later);
  }, [id, motion, still]);
}

/** The explorer as a picture poses it: unfolded, nothing selected. */
const POSED_EXPLORER: BlueprintStep = { at: 'explorer', id: 0, selected: [], picking: false, aside: false, setAside: [] };

export function useBlueprintShelf(): BlueprintShelfModel {
  const { all, folders } = useLibrary();
  const posed = useUiPreviewPose()?.blueprintExplorer;
  const liveUi = useEditorStore((s) => s.blueprint);
  const liveStep = useEditorStore((s) => s.blueprintStep);
  const ui = useMemo(() => (posed ? { ...liveUi, folder: null, view: posed.view, sort: null } : liveUi), [posed, liveUi]);
  const step = posed ? POSED_EXPLORER : liveStep;
  const unfolded = explorerUnfolded(step);
  const lifted = useEditorStore((s) => s.viewMode === '3d');
  const setUi = useEditorStore((s) => s.setBlueprintUi);
  const locale = useLocale();
  const reduced = useReducedMotionConfig() === true;
  const preview = useUiPreview();
  const touch = useTouchMode();
  const still = reduced || preview;
  const run = useRunCommand();
  // New blueprint pressed in the open explorer: the strip its fold left, waiting for the fold to land.
  const [framing, setFraming] = useState<number | null>(null);
  useAfterMotion(framing, 'blueprint.library.unfold', still, (strip) => {
    setFraming(null);
    // A mode, an unfolding or a step chosen while it folded keeps what was chosen.
    const { selectingRegion, blueprintStep } = useEditorStore.getState();
    if (!selectingRegion && blueprintStep.at === 'strip' && blueprintStep.id === strip) run('blueprints.frame', { from: 'explorer' });
  });
  // A frame step left for the explorer it was started in: the strip comes back from under it on the
  // bar's handover, then unfolds, as entering went the other way.
  const reopening = step.at === 'strip' && step.reopening ? step.id : null;
  useAfterMotion(reopening, 'mode.bar.cover', still, reopenBlueprintLibrary);
  const [query, setQuery] = useState('');
  const [warm, setWarm] = useState(false);
  // An unfolding or fold took the explorer it warmed, or let it go.
  useEffect(() => { setWarm(false); }, [unfolded]);
  // Read by presses after this render, once `view` below stands.
  const selectedNow = () => selectionShown(view, useEditorStore.getState().blueprintStep);
  const layout = useFrameLayout();
  const { scale } = usePx();
  const zoom = useFrameZoom();
  const card = stripCard(layout, scale);
  const carry = useBlueprintCarry({
    unfolded: () => explorerUnfolded(useEditorStore.getState().blueprintStep),
    selectedNow,
    foldAside: () => useEditorStore.getState().setBlueprintExplorerAside(),
    unfoldAgain: (explorer) => useEditorStore.getState().endBlueprintExplorerAside(explorer),
    card: () => ({ w: card.w * zoom, h: card.h * zoom }),
    listSorted: () => useEditorStore.getState().blueprint.sort !== null,
    unsort: () => useEditorStore.getState().setBlueprintUi({ sort: null }),
  });

  const view = libraryView({ records: all, folders, ui, step, query, locale: localeTag(locale) });
  const { exportScope } = view;

  return {
    folders, folderName: blueprintFolderName, folder: view.folder, query, searching: view.searching, records: view.cards, listed: view.listed,
    order: view.order, lifted,
    countOf: (folder) => view.counts.get(folder) ?? 0,
    setQuery: (next) => { setQuery(next); setUi({ selected: [] }); },
    setFolder: (folder) => { setQuery(''); setUi({ folder, selected: [] }); },
    armed: view.armed,
    toggle: (id) => run('blueprints.arm', id === ui.armed ? {} : { id }),
    newBlueprint: () => {
      // The command folds an open explorer itself; where the fold plays, the step waits for it to land.
      if (!unfolded || still) run('blueprints.frame'); else setFraming(foldBlueprintLibraryForFrame());
    },
    addFolder: (name) => {
      // The command opens the folder it made; the search gives way to it.
      void runCommand('blueprints.folder_create', { name }).then((made) => { if (made.ok) setQuery(''); });
    },
    rename: (id, name) => pressCommand('blueprints.rename', { id, name }),
    move: (ids, folder) => pressCommand('blueprints.move', { ids: ids.join(','), ...(folder === null ? {} : { folder }) }),
    exportScope,
    remove: (ids) => { void deleteBlueprints(ids); },
    renameFolder: async (from, to) => (await runCommand('blueprints.folder_rename', { folder: from, name: to })).ok,
    removeFolder: (folder) => { void deleteBlueprintFolder(folder); },
    unfolded,
    unfold: (next, choice) => { if (next) setFraming(null); unfoldBlueprintLibrary(next, choice); },
    take: (id) => run('blueprints.arm', { id }),
    selected: view.selected,
    selectedNow,
    select: (ids) => setUi({ selected: ids }),
    menuOn: menuButtonOn(view.selected, step, touch),
    view: ui.view,
    setView: (view) => setUi({ view }),
    sort: ui.sort,
    setSort: (sort) => setUi({ sort }),
    picking: step.at === 'explorer' && step.picking,
    setPicking: (picking) => setUi(picking ? { picking } : { picking, selected: [] }),
    carry,
    warm,
    setWarm,
  };
}

/** Which of the shelf's re-arrangements a commit makes: the strip unfolding into the explorer or
 *  folding back (`blueprint.library.unfold`), or the open explorer switching its view, folder or
 *  search (`blueprint.library.arrange`). */
export type ShelfChange = 'unfold' | 'arrange';

/** What a shelf's morph watches: `change`, which every re-arrangement changes, and, read as a commit
 *  is measured, which re-arrangement that commit makes. */
export function useShelfChange(model: BlueprintShelfModel): { change: string; changing: () => ShelfChange } {
  // Measured before the commit's layout effects run, so this is still the unfolding the screen shows.
  const was = useRef(model.unfolded);
  useLayoutEffect(() => { was.current = model.unfolded; });
  const shown = model.unfolded ? `${model.view}|${model.searching ? `?${model.query.trim()}` : `/${model.folder ?? ''}`}` : '';
  return { change: `${model.unfolded}|${shown}`, changing: () => (was.current !== model.unfolded ? 'unfold' : 'arrange') };
}

/** What a piece wears, by its id, the shape it travels in where it has one, and what it rides where it
 *  travels with another (`usePieces`). */
export type Pieces = (id: string, shape?: MorphShape, ride?: Ride) => Record<string, string>;

/** What a piece of the strip or the explorer wears so the unfolding carries it from one to the other
 *  (`primitives/morph.ts:morphScope`), by an id both arrangements give it, the shape it travels in
 *  where it has one, and what it rides; a pictured subtree marks nothing. */
export function usePieces(): Pieces {
  const preview = useUiPreview();
  const kept = useContext(PiecesKept);
  const off = preview || kept;
  return (id, shape, ride): Record<string, string> => (off ? {} : {
    [MORPH_PIECE_ATTR]: id, ...(shape ? { [MORPH_SHAPE_ATTR]: shape } : {}), ...rideAttrs(ride),
  });
}

/** The band the wide strip and explorer stand on, as the box the unfold square rides; its owner glides
 *  its edges itself (`BlueprintShelf.tsx`). */
const BAND_GUIDE = 'band';

/** What the band wears as the box pieces ride; a pictured subtree marks nothing. */
export function useBandGuide(): Record<string, string> {
  return useUiPreview() ? {} : { [MORPH_GUIDE_ATTR]: BAND_GUIDE };
}

/** The unfold square, and the delete target standing in its place: pinned to the band's top right
 *  corner, it moves only as that corner does. */
export const SQUARE_RIDE: Ride = { on: BAND_GUIDE, at: ['top', 'right'] };

/** Whether the pieces below stand mounted out of sight (`BlueprintExplorer.tsx:ExplorerKept`): they wear
 *  no id then, so a morph measures the shown strip's pieces of the same ids, not these. */
export const PiecesKept = createContext(false);

/** A folder's piece id, All's for null, the same for its tab on the strip and its entry in the explorer. */
export const folderPiece = (folder: string | null): string => (folder === null ? ALL_PIECE : `folder:${folder}`);

/** All's piece, the one folder name that travels between the tabs and the folder list: the others
 *  ride it, crossing over between the row and the list. */
const ALL_PIECE = 'folder';

/** What a folder's tab or entry rides: nothing for All, which travels, All for the rest. */
export const folderRide = (folder: string | null): Ride | undefined => (folder === null ? undefined : { on: ALL_PIECE });
