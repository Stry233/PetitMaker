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
import { viewportSize } from '../../../platform/device/viewport-space';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getActiveView, onProjectionChange } from '../../../view/active-view';
import { zoneCellCentre, zoneGrid, type MapAnnotation } from '../../../core/model/annotations';
import { zoneLabelAnchor } from '../../../core/model/annotation/geometry';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { flipMeasures, mergeZones, removeNotes } from '../../../editor/editing/annotation-edit';
import { btnReset, cursors, font, z, radii, UNAVAILABLE } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { PANEL_EDGE, PLATE, PLATE_INK, DANGER_INK } from '../../design/tokens';
import { MeasurementHandles } from './MeasurementHandles';
import { framerMotion } from '../../design/motion';

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
  const epoch = useEditorStore((s) => s.annotationsEpoch);
  // The projection is not reactive, so the camera and the view report through a tick.
  const [tick, setTick] = useState(0);
  useEffect(() => onProjectionChange(eventBus, () => setTick((n) => n + 1)), [eventBus]);
  void epoch;
  void tick;

  const items = useEditorStore.getState().gridState?.annotations?.items ?? [];
  const picked = selection.map((id) => items.find((n) => n.id === id)).filter((n): n is MapAnnotation => !!n);
  const data = useEditorStore.getState().gridState?.annotations;
  const measurement = picked.length === 1 && picked[0]?.kind === 'measure' ? picked[0] : null;
  return (
    <>
    {mode === 'annotate' && data?.visible && !data.locked && measurement
      ? <MeasurementHandles key={measurement.id} note={measurement} /> : null}
    <AnimatePresence>
      {mode === 'annotate' && data?.visible && picked.length > 0
        ? <SelectedVerbs key={`verbs-${picked[picked.length - 1]!.id}-${picked.length}`} notes={picked} />
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

function SelectedVerbs({ notes }: { notes: MapAnnotation[] }) {
  const t = useT();
  // The row stands at the LAST-picked note: that is where the hand already is.
  const note = notes[notes.length - 1]!;
  const at = screenAnchor(note);
  if (!at || at.behind) return null;
  const s = () => useEditorStore.getState();
  const locked = s().gridState?.annotations?.locked === true;
  const mergeable = notes.length > 1 && notes.every((n) => n.kind === 'zone');
  const flippable = notes.every(n => n.kind === 'measure');
  const verb = (label: string, onPress: () => void, danger?: boolean) => (
    <button
      type="button"
      disabled={locked}
      onClick={onPress}
      style={{
        ...btnReset, cursor: cursors.clickable,
        padding: '6px 10px', borderRadius: radii.chip,
        fontFamily: font.family, ...roleFont('chip'),
        color: danger ? DANGER_INK : PLATE_INK,
        opacity: locked ? UNAVAILABLE : 1,
      }}
    >
      {label}
    </button>
  );
  return (
    <motion.div
      {...helpTargetAttr('notes', 'notes-select')}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.85, opacity: 0, transition: framerMotion('surface.leave') }}
      transition={framerMotion('surface.pop')}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(viewportSize().width - 190, at.x - 85)),
        top: Math.max(60, at.y - 56),
        zIndex: z.canvasControls,
        display: 'flex', gap: 2, padding: 4,
        background: PLATE, border: PANEL_EDGE, borderRadius: radii.md,
      }}
    >
      {mergeable ? verb(t('annot.merge'), () => mergeZones(notes.map((n) => n.id))) : null}
      {flippable ? verb(t('annot.flip'), () => flipMeasures(notes.map((n) => n.id))) : null}
      {verb(t('annot.delete'), () => removeNotes(notes.map((n) => n.id)), true)}
    </motion.div>
  );
}
