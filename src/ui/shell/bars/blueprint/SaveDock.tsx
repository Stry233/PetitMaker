/**
 * Blueprint mode's save step: a dock on the window plate floating over the bottom of the map in the
 * bar's place, the frame's 2D and 3D pictures as two of the strip's blueprint cards beside one field
 * grid (name and author, then folder and the actions), and a viewfinder outlined over the map above
 * it, the map around it dimmed. Each view is brought so the frame fills the viewfinder the first time
 * it is shown (`fitFrameToViewfinder`); the viewfinder then stays put while the map moves under it,
 * and the pictures are drawn live through it (`watchFramedThumbs`), the shown view's card chosen. A
 * press on the other card switches the map's view, and the save stores each view as it was last
 * framed; a turned screen fits each view to its new viewfinder again. Mounted afresh with each opening,
 * so every field starts from the library and the last author.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { rgbaOf } from '../../../../core/base/color';
import { fitAspect, type Rect } from '../../../../core/grid/rect';
import { useT } from '../../../../i18n/context';
import { BLUEPRINT_NAME_MAX, THUMB_ASPECT } from '../../../../io/blueprint/facts';
import { SUPPORTS_TYPED_AUTHOR } from '../../../../platform/build/edition';
import {
  adaptedFrom, authorAllowed, blueprintFolderName, blueprintFolders, defaultSaveFolder, fieldsAuthor, fitFrameToViewfinder, knownAuthor,
  lastBlueprintAuthor, newBlueprintPlaceholderName, originFor, platformAuthor, saveAllowed, shownBlueprints, watchFramedThumbs,
  type FramedPictures,
} from '../../../../editor/editing/blueprint';
import { backOut } from '../../../../editor/back/back-out';
import type { ViewMode } from '../../../../state/slices/prefs';
import type { ScreenBox } from '../../../../tools/pointer/runtime';
import { REGION_EDGE } from '../../../../view/shared/overlay/region-edge';
import { blueprintSavable } from '../../../../state/slices/shell';
import { useEditorStore } from '../../../../state/store';
import { arrangementFades } from '../../../design/motion';
import { btnReset, cursors, shadows } from '../../../design/styles';
import { cozyPanel, skin, windowCard, WINDOW_FIELD_BOX } from '../../../design/window-skin';
import { useLayoutShape } from '../../../design/input-mode';
import { useUiPreviewPose } from '../../../design/preview';
import { useViewportSize } from '../../../design/scale';
import { visualRect } from '../../../design/visual-rect';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useVersioned } from '../../../primitives/use-versioned';
import { ActionButton } from '../../../primitives/ActionButton';
import { FloatMenu } from '../../../primitives/FloatMenu';
import { Switch } from '../../../primitives/Switch';
import { helpTargetAttr } from '../../../session/help-targets';
import { tourTargetAttr } from '../../../chrome/tour/steps';
import { FIELD_CAPTION_GAP, fieldCaption, Label } from '../../../chrome/modals/export/ExportControls';
import { ReviewedTextField, useReviewedText } from '../../../chrome/modals/export/review/ReviewedTextField';
import { ChosenPlate, CardFace } from '../generate/CandidateCard';
import { useFrameLayout } from '../../frame-layout';
import { useMapLayer } from '../../map-layer';
import { EDGE } from '../../units';
import { useRunCommand } from '../../use-shell-commands';
import { Action } from '../bar-atoms';
import { PanelTone } from '../bar-panel';
import { BLUEPRINT_CARD_ASPECT, CardLine } from './BlueprintCard';
import { useBlueprintLibraryVersion } from './use-blueprint-shelf';

/** The grid's one spacing unit, the export window's row gap. */
const UNIT = 12;
/** The dock's padding around its grid. */
const PAD = 16;
/** A field caption's line: the export panel's caption, a label, set solid. */
const CAPTION_LINE = 16;
/** The tiles' height on a wide screen: the two field rows with their captions and the unit between. */
const TILES_H = 2 * (CAPTION_LINE + FIELD_CAPTION_GAP + WINDOW_FIELD_BOX) + UNIT;
/** The dock's widest, in frame px. */
const DOCK_MAX_W = 1072;
/** The folder menu's id for no folder, which no folder name can be. */
const NO_FOLDER = '';

const caption: CSSProperties = { ...fieldCaption, lineHeight: `${CAPTION_LINE}px`, minWidth: 0 };

/** The viewfinder's outline, the frame step's region edge with each line centred on the box's edge,
 *  over the 3D shot frame's dim of everything around it. */
const VIEWFINDER_LOOK = [
  ...[...REGION_EDGE].reverse()
    .flatMap(({ width, color, alpha }) => [`0 0 0 ${width / 2}px`, `inset 0 0 0 ${width / 2}px`].map((ring) => `${ring} ${rgbaOf(color, alpha)}`)),
  shadows.spotlight,
].join(', ');

/** The largest box at the pictures' shape inside `area`, centred in it; null with no room. */
function viewfinderIn(area: { left: number; top: number; right: number; bottom: number }): ScreenBox | null {
  const w = area.right - area.left, h = area.bottom - area.top;
  if (w <= 0 || h <= 0) return null;
  const box = fitAspect({ x: area.left, y: area.top, w, h }, THUMB_ASPECT);
  return { left: box.x, top: box.y, width: box.w, height: box.h };
}

/** Where `el` stands on the screen, or null before it is laid out. */
function screenBoxOf(el: Element | null): ScreenBox | null {
  const r = el ? visualRect(el) : null;
  return r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/** The step standing in the bar's place while the save step stands, on its frame. */
export function SaveDock() {
  const pictured = useUiPreviewPose()?.blueprintSave === true;
  const frame = useEditorStore((s) => (s.blueprintStep.at === 'save' ? s.blueprintStep.frame : null));
  if (pictured) return <Dock frame={PICTURED_FRAME} pictured />;
  return frame ? <Dock key={`${frame.x},${frame.y},${frame.w},${frame.h}`} frame={frame} /> : null;
}

/** The frame a pictured dock stands for, which it never captures, fits or draws. */
const PICTURED_FRAME: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** A pictured dock's two pictures: the library's first blueprint that has both, read again when the
 *  library changes; null outside a picture. */
function usePicturedShots(pictured: boolean): { flat: string; lifted: string } | null {
  const first = () => shownBlueprints().find((r) => r.thumbs.flat && r.thumbs.lifted)?.thumbs ?? null;
  return useVersioned(() => (pictured ? first() : null), [pictured, useBlueprintLibraryVersion()]);
}

/** The library's folders, read again whenever it changes. */
function useFolders(): readonly string[] {
  return useVersioned(blueprintFolders, [useBlueprintLibraryVersion()]);
}

function Dock({ frame, pictured = false }: { frame: Rect; pictured?: boolean }) {
  const t = useT();
  const upright = useLayoutShape() === 'portrait';
  const layout = useFrameLayout();
  const run = useRunCommand();
  const view = useEditorStore((s) => s.viewMode);
  const folders = useFolders();
  const [pictures, setPictures] = useState<FramedPictures | null>(null);
  const posedShots = usePicturedShots(pictured);
  const shots = pictured ? posedShots : pictures;
  const dockRef = useRef<HTMLElement>(null);
  const finderRef = useRef<HTMLDivElement>(null);
  // The dock's own height in frame px and the arrangement it was measured in, null until it is measured.
  const [dock, setDock] = useState<{ h: number; upright: boolean } | null>(null);
  useObservedSize(() => dockRef.current, ([el]) => {
    const h = el!.offsetHeight;
    setDock((was) => (was?.h === h && was.upright === upright ? was : { h, upright }));
  }, [upright]);
  const viewport = useViewportSize();
  const mapLayer = useMapLayer();
  const reduced = useReducedMotionConfig();
  const dockBottom = (layout?.bar.bottom ?? 0) + EDGE;
  // The map left above the dock, under the top row and beside the column.
  const finder = dock === null ? null : viewfinderIn({
    left: layout?.edgeLeft ?? EDGE,
    top: layout ? Math.max(layout.railTop, layout.panel.top) : EDGE,
    right: layout ? layout.width - layout.rail.plateRight : viewport.w - EDGE,
    bottom: (layout?.height ?? viewport.h) - dockBottom - dock.h - EDGE,
  });
  const placed = finder !== null;
  // A turned screen stands a new viewfinder, which each view fills again once the dock is measured in it.
  const turned = dock?.upright;
  // A picture moves no camera and draws no pictures.
  const live = placed && !pictured;
  useEffect(() => (live ? fitFrameToViewfinder(frame, () => screenBoxOf(finderRef.current)) : undefined), [frame, live, turned]);
  useEffect(() => (live ? watchFramedThumbs(frame, () => screenBoxOf(finderRef.current), setPictures) : undefined), [frame, live]);
  const origin = useMemo(() => (pictured ? null : originFor(frame)), [frame, pictured]);
  const known = useMemo(lastBlueprintAuthor, []);
  // Read again in the interface language when it changes.
  const placeholder = useVersioned(newBlueprintPlaceholderName, [t]);

  const [name, setName] = useState('');
  const [author, setAuthor] = useState(known ?? '');
  const [anonymous, setAnonymous] = useState(known === null);
  const toggleAnonymous = () => {
    if (!anonymous || authorAllowed(author)) { setAnonymous((was) => !was); return; }
    // The field holds no author the edition lets a save name, so the platform is asked for one: it
    // may first ask the player's consent, so this runs only from the switch's press.
    void platformAuthor().then((given) => {
      if (given === null) return;
      setAuthor(given);
      setAnonymous(false);
    });
  };
  const [folder, setFolder] = useState<string | null>(defaultSaveFolder);
  const [picking, setPicking] = useState(false);
  // Save was pressed and the record has not landed: nothing backs out or saves again meanwhile.
  const saving = useEditorStore((s) => s.blueprintStep.at === 'save' && s.blueprintStep.pending);
  const savable = useEditorStore(blueprintSavable);
  const nameCheck = useReviewedText(true, name, '', 'blueprint-name');
  const authorCheck = useReviewedText(!anonymous, author, useMemo(() => knownAuthor(author), [author]), 'blueprint-author');

  const typed = { name, author, anonymous, folder };
  const adapted = adaptedFrom(origin, fieldsAuthor(typed));
  const canSave = savable && saveAllowed(typed, { name: nameCheck.approved, author: authorCheck.approved }, saving);
  const save = () => {
    if (!canSave) return;
    // A blank name takes the numbered default, no author saves anonymously and no folder files under none.
    const store = () => run('blueprints.save', {
      ...(name.trim() ? { name } : {}), ...(anonymous ? {} : { author }), ...(folder === null ? {} : { folder }),
    });
    nameCheck.commit(() => (anonymous ? store() : authorCheck.commit(store)));
  };

  const tiles = (
    <div style={upright
      ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: UNIT }
      : { display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: UNIT, height: TILES_H }}>
      <Tile which="2d" label={t('blueprint.thumb_flat')} src={shots?.flat} shown={view === '2d'} upright={upright} onPress={() => run('view.toggle')} />
      <Tile which="3d" label={t('blueprint.thumb_lifted')} src={shots?.lifted} shown={view === '3d'} upright={upright} onPress={() => run('view.toggle')} />
    </div>
  );

  const box = `${WINDOW_FIELD_BOX}px`;
  const fieldRow = `minmax(${box}, auto)`;
  const labelRows = `${CAPTION_LINE}px ${FIELD_CAPTION_GAP}px`;
  const fields = (
    <div data-save-fields="" style={{
      display: 'grid', columnGap: UNIT, minWidth: 0, alignItems: 'start',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: upright
        ? `${labelRows} ${fieldRow} ${UNIT}px ${labelRows} ${fieldRow} ${UNIT}px ${labelRows} ${box}`
        : `${labelRows} ${fieldRow} ${UNIT}px ${labelRows} ${box}`,
      gridTemplateAreas: upright
        ? '"nl nl" ". ." "nc nc" ". ." "al al" ". ." "ac ac" ". ." "fl ." ". ." "fc x"'
        : '"nl al" ". ." "nc ac" ". ." "fl ." ". ." "fc x"',
    }}>
      <span style={{ gridArea: 'nl', display: 'flex', justifyContent: 'space-between', gap: UNIT, minWidth: 0 }}>
        <span style={caption}>{t('blueprint.save_name')}</span>
        {adapted !== null && (
          <span style={{ ...caption, display: 'flex', gap: 4, overflow: 'hidden' }}>
            <span style={{ color: skin.muted, flex: 'none' }}>{t('blueprint.adapted_from')}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={adapted}>{adapted}</span>
          </span>
        )}
      </span>
      <div style={{ gridArea: 'nc', minWidth: 0 }}>
        <ReviewedTextField check={nameCheck} value={name} onChange={setName} onSubmit={() => { void save(); }} height={WINDOW_FIELD_BOX}
          label={t('blueprint.save_name')} placeholder={placeholder} maxLength={BLUEPRINT_NAME_MAX}
          refusedText={t('blueprint.name_refused')} unavailableText={t('blueprint.check_unavailable')} />
      </div>
      <span style={{ ...caption, gridArea: 'al' }}>{t('blueprint.field_author')}</span>
      <div style={{ gridArea: 'ac', minWidth: 0 }}>
        <ReviewedTextField check={authorCheck} value={author} onChange={setAuthor} readOnly={!SUPPORTS_TYPED_AUTHOR}
          onSubmit={() => { void save(); }} height={WINDOW_FIELD_BOX}
          placeholder={SUPPORTS_TYPED_AUTHOR ? undefined : t('blueprint.author_from_profile')}
          label={t('blueprint.field_author')} maxLength={BLUEPRINT_NAME_MAX} disabled={anonymous}
          refusedText={t('blueprint.author_refused')} unavailableText={t('blueprint.check_unavailable')}
          trailing={<span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
            <Label text={t('blueprint.anonymous')} />
            <Switch on={anonymous} onClick={toggleAnonymous} label={t('blueprint.anonymous')} />
          </span>} />
      </div>
      <span style={{ ...caption, gridArea: 'fl' }}>{t('blueprint.save_folder')}</span>
      {/* The menu's own row, stretched to the field box beside the actions. */}
      <div style={{ gridArea: 'fc', display: 'flex', height: WINDOW_FIELD_BOX, minWidth: 0 }}>
        <FloatMenu
          aria-label={t('blueprint.save_folder')}
          row={folder === null ? t('blueprint.save_no_folder') : blueprintFolderName(folder)}
          items={[{ id: NO_FOLDER, label: t('blueprint.save_no_folder') }, ...folders.map((f) => ({ id: f, label: blueprintFolderName(f) }))]}
          activeId={folder ?? NO_FOLDER}
          open={picking}
          onOpen={() => setPicking(true)}
          onClose={() => setPicking(false)}
          onPick={(id) => { setFolder(id === NO_FOLDER ? null : id); setPicking(false); }}
        />
      </div>
      <div style={{ gridArea: 'x', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: UNIT, height: WINDOW_FIELD_BOX, minWidth: 0 }}>
        <Action label={t('blueprint.cancel')} disabled={saving} height={WINDOW_FIELD_BOX} onPress={() => { backOut(); }} />
        <Action label={t('blueprint.save')} primary disabled={!canSave} height={WINDOW_FIELD_BOX} onPress={() => { void save(); }} />
      </div>
    </div>
  );

  // The viewfinder fades in and out with the dock (`controls/ModeBar.tsx`), on the frame's map layer so
  // the chrome stands over its dim, and placed in the layer, which clips the dim to the frame's box (off a docked assistant).
  const fades = arrangementFades('mode.bar.cover', reduced);
  const viewfinder = finder && !pictured && (
    <motion.div ref={finderRef} data-testid="blueprint-viewfinder" aria-hidden
      initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fades.in }} exit={{ opacity: 0, transition: fades.out }}
      style={{ position: mapLayer ? 'absolute' : 'fixed', ...finder, pointerEvents: 'none', boxShadow: VIEWFINDER_LOOK }} />
  );

  return (
    <>
      {viewfinder && (mapLayer ? createPortal(viewfinder, mapLayer) : viewfinder)}
      <div style={{
        // Wide it is centred on the window over whatever stands beneath, the rail included; upright it keeps the plan's margins.
        position: 'fixed', left: upright ? layout?.edgeLeft ?? EDGE : EDGE, right: upright ? layout?.edgeRight ?? EDGE : EDGE,
        bottom: dockBottom,
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <section ref={dockRef} aria-label={t('blueprint.save')} {...helpTargetAttr('blueprint-save', 'bpsave-panel')} {...tourTargetAttr('blueprint-save')} style={{
          ...cozyPanel, ...windowCard,
          pointerEvents: 'auto', width: '100%', maxWidth: upright ? undefined : DOCK_MAX_W, boxSizing: 'border-box',
          display: 'grid', gridTemplateColumns: upright ? 'minmax(0, 1fr)' : 'auto minmax(0, 1fr)', gap: UNIT, padding: PAD,
        }}>
          {/* The window plate, which the bar's actions stand on as on a cream panel. */}
          <PanelTone tone="cream">{tiles}{fields}</PanelTone>
        </section>
      </div>
    </>
  );
}

/** One view's live picture as a blueprint card of the strip, its view named on the card's line and
 *  wearing the chosen plate while it is the view shown; a press on the other view's card switches the
 *  map to it. */
function Tile({ which, label, src, shown, upright, onPress }: {
  which: ViewMode; label: string; src: string | null | undefined; shown: boolean; upright: boolean; onPress: () => void;
}): ReactNode {
  return (
    <ActionButton interaction="action" aria-label={label} aria-pressed={shown} data-view={which}
      onClick={() => { if (!shown) onPress(); }}
      style={{
        ...btnReset, position: 'relative', display: 'block', aspectRatio: String(BLUEPRINT_CARD_ASPECT),
        ...(upright ? { width: '100%' } : { height: '100%' }), cursor: shown ? cursors.default : cursors.clickable,
      }}>
      <ChosenPlate chosen={shown} />
      {/* A picture not drawn yet waits on the card's loading dots. */}
      <CardFace shot={src ?? undefined} waited={false} />
      <CardLine text={label} />
    </ActionButton>
  );
}
