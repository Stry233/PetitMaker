/*
 * The plan-notes chrome that follows the map: the small verb row a selected
 * note carries (delete, and merge for several zones).
 *
 * It anchors to the note through the active view's projection (`cellToScreen`), so it stands over
 * the same spot in 2D and 3D, and re-tracks the way the selection handles do: on viewport-changed,
 * on a view swap, and on the annotation epoch. Tag, color and size are not here: the bar's rows
 * are the one place they are picked, and a pick applies to the selection.
 *
 * A multi-selection (Ctrl-clicks) carries its own verb row at the last-picked note: delete takes
 * the whole set as one undo entry, and merge, offered when everything selected is a zone, folds
 * the others' cells into the FIRST-picked zone, which keeps its tag, number and colour.
 */
import { helpTargetAttr } from '../../session/help-targets';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getActiveView, onProjectionChange } from '../../../view/active-view';
import { zoneCellCentre, zoneGrid, type MapAnnotation } from '../../../core/model/annotations';
import { zoneLabelAnchor } from '../../../core/model/annotation/geometry';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { flipMeasures, mergeZones, removeNotes } from '../../../editor/editing/annotation-edit';
import { btnReset, cursors, font, z, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { PANEL_EDGE, PLATE, PLATE_INK, DANGER_INK } from '../../design/tokens';
import { TOUCH_TARGET } from '../../design/scale';
import { MeasurementHandles } from './MeasurementHandles';
import { presence } from '../../design/motion';
import { ActionButton } from '../../primitives/ActionButton';
import { useChromeLayer, useChromeLayerZoom } from '../../primitives/chrome-layer';
import { useFloatingPosition } from '../../primitives/use-floating-position';
import { useVersioned } from '../../primitives/use-versioned';

/** Between the verb row and the note it stands over, in the row's px. */
const ROW_GAP = 16;

/** Where a note's chrome stands: the note's own anchor, projected. */
function anchorOf(note: MapAnnotation): { x: number; y: number } {
  if (note.kind === 'zone') return zoneLabelAnchor(note.cells, zoneGrid(note));
  if (note.kind === 'chip') return { x: note.x, y: note.y };
  return note.kind === 'measure' ? zoneCellCentre(note.points[0]) : { x: note.points[0]!.x, y: note.points[0]!.y };
}

export function AnnotationEditor() {
  const mode = useEditorStore((s) => s.editMode.mode);
  const eventBus = useEditorStore((s) => s.eventBus);
  const selection = useEditorStore((s) => s.annotationSelection);
  const data = useEditorStore((s) => s.gridState?.annotations);
  // The notes are edited in place, so they are read again on each annotation epoch.
  const epoch = useEditorStore((s) => s.annotationsEpoch);
  // The projection is not reactive, so the camera and the view render the editor again through a tick.
  const [, setTick] = useState(0);
  useEffect(() => onProjectionChange(eventBus, () => setTick((n) => n + 1)), [eventBus]);

  const picked = useVersioned(() => {
    const items = data?.items ?? [];
    return selection.map((id) => items.find((n) => n.id === id)).filter((n): n is MapAnnotation => !!n);
  }, [data, selection, epoch]);
  const measurement = picked.length === 1 && picked[0]?.kind === 'measure' ? picked[0] : null;
  return (
    <>
    {mode === 'annotate' && data?.visible && !data.locked && measurement
      ? <MeasurementHandles key={measurement.id} note={measurement} /> : null}
    <AnimatePresence>
      {mode === 'annotate' && data?.visible && picked.length > 0
        ? <SelectedVerbs key={`verbs-${picked[picked.length - 1]!.id}-${picked.length}`} notes={picked} locked={data.locked === true} />
        : null}
    </AnimatePresence>
    </>
  );
}

function screenAnchor(note: MapAnnotation): { x: number; y: number; behind: boolean } | null {
  const proj = getActiveView()?.projection;
  if (!proj) return null;
  const label = proj.annotationLabelBox?.(note.id);
  if (label) return { x: label.x + label.w / 2, y: label.y, behind: false };
  const a = anchorOf(note);
  const s = proj.cellToScreen(a.x, a.y);
  return { x: s.x, y: s.y, behind: s.behind === true };
}

/** The verb row over the selected notes, re-reading its anchor on every render of the editor. */
function SelectedVerbs({ notes, locked }: { notes: MapAnnotation[]; locked: boolean }) {
  const t = useT();
  // The row stands at the LAST-picked note: that is where the hand already is.
  const note = notes[notes.length - 1]!;
  const at = screenAnchor(note);
  const shown = !!at && !at.behind;
  // Touch mode draws the row at least at its own size, so its verbs stay a fingertip's reach.
  const layer = useChromeLayer({ control: TOUCH_TARGET });
  const zoom = useChromeLayerZoom(TOUCH_TARGET);
  const floating = useFloatingPosition({ open: shown, anchor: at ?? { x: 0, y: 0 }, zoom, align: 'center', prefer: 'above', gap: ROW_GAP });
  if (!shown) return null;
  const mergeable = notes.length > 1 && notes.every((n) => n.kind === 'zone');
  const flippable = notes.every(n => n.kind === 'measure');
  const verb = (label: string, onPress: () => void, danger?: boolean) => (
    <ActionButton
      interaction="pill"
      disabled={locked}
      onClick={onPress}
      style={{
        ...btnReset, ...(locked ? null : { cursor: cursors.clickable }),
        padding: '6px 10px', borderRadius: radii.chip,
        fontFamily: font.family, ...roleFont('chip'),
        color: danger ? DANGER_INK : PLATE_INK,
      }}
    >
      {label}
    </ActionButton>
  );
  return (
    <motion.div
      ref={floating.ref}
      {...floating.piece}
      {...helpTargetAttr('notes', 'notes-select')}
      {...presence('surface.pop', { scale: 0.85, opacity: 0 }, { leave: 'surface.leave' })}
      style={{
        ...layer, ...floating.style,
        zIndex: z.canvasControls,
        display: 'flex', gap: 2, padding: 4,
        background: PLATE, border: PANEL_EDGE, borderRadius: radii.md,
        visibility: floating.placement ? 'visible' : 'hidden',
      }}
    >
      {mergeable ? verb(t('annot.merge'), () => mergeZones(notes.map((n) => n.id))) : null}
      {flippable ? verb(t('annot.flip'), () => flipMeasures(notes.map((n) => n.id))) : null}
      {verb(t('annot.delete'), () => removeNotes(notes.map((n) => n.id)), true)}
    </motion.div>
  );
}
