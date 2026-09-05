/*
 * AnnotationEditor.tsx — the plan-notes chrome that follows the map: the name field a fresh zone
 * or text note opens into, and the small verb row a selected note carries (rename, delete).
 *
 * It anchors to the note through the ACTIVE view's projection (`cellToScreen`), so it stands over
 * the same spot in 2D and 3D, and re-tracks the way the selection handles do: on viewport-changed,
 * on a view swap, and on the annotation epoch. Recoloring is not here — the bar's swatch row is
 * the one place a color is picked, selected note or not.
 *
 * A MULTI-SELECTION (Ctrl-clicks) carries its own verb row at the last-picked note: delete takes
 * the whole set as one undo entry, and merge — offered when everything selected is a zone —
 * folds the others' cells into the FIRST-picked zone, which keeps its name, number and colour.
 *
 * THE FIELD COMMITS TO TWO HOMES: a DRAFT text note becomes a note only on Enter with words in the
 * field (Escape discards it, and an empty commit is the same discard — an empty label is not a
 * note), while a committed note's rename writes through the slice and an empty rename simply
 * closes (a zone with no name is a legal zone).
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getActiveView, onActiveViewChange } from '../../../canvas/active-view';
import { zoneCentroid, type MapAnnotation } from '../../../core/model/annotations';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { endCurveSession } from '../../../tools/paint';
import { btnReset, colors, cursors, exitTransition, font, pressable, springs, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { INK, PANEL_EDGE, PLATE, PLATE_INK, plateShapeEdge } from '../../design/tokens';

const FIELD_W = 200;
/** The confirm/cancel pair beside the field: two round buttons at the field's own height. */
const FIELD_BTN = 34;
const FIELD_ROW_W = FIELD_W + 2 * (FIELD_BTN + 6);

/** Where a note's chrome stands: the note's own anchor, projected. */
function anchorOf(note: MapAnnotation): { x: number; y: number } {
  if (note.kind === 'zone') return zoneCentroid(note.cells);
  if (note.kind === 'text') return { x: note.x, y: note.y };
  return { x: note.points[0]!.x, y: note.points[0]!.y };
}

export function AnnotationEditor() {
  const mode = useEditorStore((s) => s.editMode.mode);
  const eventBus = useEditorStore((s) => s.eventBus);
  const naming = useEditorStore((s) => s.annotationNaming);
  const selection = useEditorStore((s) => s.annotationSelection);
  const draft = useEditorStore((s) => s.annotationDraft);
  const epoch = useEditorStore((s) => s.annotationsEpoch);
  // The projection is not reactive, so the camera and the view report through a tick.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onMove = () => setTick((n) => n + 1);
    eventBus.on('viewport-changed', onMove);
    const offView = onActiveViewChange(onMove);
    return () => {
      eventBus.off('viewport-changed', onMove);
      offView();
    };
  }, [eventBus]);
  void epoch;
  void tick;

  const items = useEditorStore.getState().gridState?.annotations?.items ?? [];
  const named = naming ? (draft?.id === naming ? draft : items.find((n) => n.id === naming)) : undefined;
  const picked = named ? [] : selection.map((id) => items.find((n) => n.id === id)).filter((n): n is MapAnnotation => !!n);
  // Enter/exit motion rides AnimatePresence, so the field and the verb row arrive and leave the
  // way every other floating surface here does instead of popping.
  return (
    <AnimatePresence>
      {mode !== 'annotate' ? null
        : named ? <NameField key={`name-${named.id}`} note={named} isDraft={draft?.id === naming} />
          : picked.length > 0 ? <SelectedVerbs key={`verbs-${picked[picked.length - 1]!.id}-${picked.length}`} notes={picked} /> : null}
    </AnimatePresence>
  );
}

function screenAnchor(note: MapAnnotation): { x: number; y: number; behind: boolean } | null {
  const proj = getActiveView()?.projection;
  if (!proj) return null;
  const a = anchorOf(note);
  const s = proj.cellToScreen(a.x, a.y);
  return { x: s.x, y: s.y, behind: s.behind === true };
}

function NameField({ note, isDraft }: { note: MapAnnotation; isDraft: boolean }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = note.kind === 'zone' ? note.name : note.kind === 'text' ? note.text : '';
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const at = screenAnchor(note);
  if (!at || at.behind) return null;

  const close = () => useEditorStore.getState().setAnnotationNaming(null);
  const commit = () => {
    const s = useEditorStore.getState();
    const value = (inputRef.current?.value ?? '').trim().slice(0, note.kind === 'zone' ? 40 : 80);
    if (isDraft && note.kind === 'text') {
      s.setAnnotationDraft(null);
      if (value) {
        s.addAnnotation({ ...note, text: value });
        s.setAnnotationSelection([note.id]);
      }
    } else if (value !== initial) {
      if (note.kind === 'zone') s.updateAnnotation(note.id, { name: value });
      else if (note.kind === 'text' && value) s.updateAnnotation(note.id, { text: value });
    }
    close();
  };
  const cancel = () => {
    const s = useEditorStore.getState();
    if (isDraft) s.setAnnotationDraft(null);
    close();
  };

  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.85, opacity: 0, transition: exitTransition }}
      transition={springs.bouncy}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(window.innerWidth - FIELD_ROW_W - 16, at.x - FIELD_ROW_W / 2)),
        top: Math.max(8, at.y - 22),
        zIndex: z.canvasControls,
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      <input
        ref={inputRef}
        defaultValue={initial}
        maxLength={note.kind === 'zone' ? 40 : 80}
        placeholder={t(note.kind === 'zone' ? 'annot.name_zone' : 'annot.name_text')}
        aria-label={t(note.kind === 'zone' ? 'annot.name_zone' : 'annot.name_text')}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        onBlur={commit}
        style={{
          width: FIELD_W, padding: '8px 12px', borderRadius: 12,
          border: `2px solid ${INK}`, outline: 'none',
          background: PLATE, color: INK,
          fontFamily: font.family, ...roleFont('action'),
        }}
      />
      {/* The pair keeps the CARET: a press that stole focus would fire the field's own blur-commit
          before the cancel could speak, so the verb, not the focus change, is what acts. */}
      <FieldButton label={t('annot.confirm')} primary onPress={commit}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.panelCream} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5 10 18 19.5 6.5" /></svg>
      </FieldButton>
      <FieldButton label={t('annot.cancel')} onPress={cancel}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={PLATE_INK} strokeWidth="3.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </FieldButton>
    </motion.div>
  );
}

function FieldButton({ label, primary, onPress, children }: {
  label: string;
  primary?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      {...pressable}
      aria-label={label}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onPress}
      style={{
        ...btnReset, cursor: cursors.clickable, flex: 'none',
        width: FIELD_BTN, height: FIELD_BTN, borderRadius: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: primary ? colors.frameDark : PLATE,
        boxShadow: primary ? undefined : plateShapeEdge(),
      }}
    >
      {children}
    </motion.button>
  );
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
  const verb = (label: string, onPress: () => void, danger?: boolean) => (
    <button
      type="button"
      onClick={onPress}
      style={{
        ...btnReset, cursor: cursors.clickable,
        padding: '6px 10px', borderRadius: 9,
        fontFamily: font.family, ...roleFont('chip'),
        color: danger ? '#B03A2E' : PLATE_INK,
        opacity: locked ? 0.35 : 1,
      }}
    >
      {label}
    </button>
  );
  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.85, opacity: 0, transition: exitTransition }}
      transition={springs.bouncy}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(window.innerWidth - 190, at.x - 85)),
        top: Math.max(60, at.y - 56),
        zIndex: z.canvasControls,
        display: 'flex', gap: 2, padding: 4,
        background: PLATE, border: PANEL_EDGE, borderRadius: 12,
      }}
    >
      {notes.length === 1 && note.kind !== 'route'
        ? verb(t('annot.rename'), () => { if (!locked) s().setAnnotationNaming(note.id); })
        : null}
      {mergeable
        ? verb(t('annot.merge'), () => { if (!locked) s().mergeAnnotationZones(notes.map((n) => n.id)); })
        : null}
      {verb(t('annot.delete'), () => {
        if (locked) return;
        endCurveSession();
        s().removeAnnotations(notes.map((n) => n.id));
      }, true)}
    </motion.div>
  );
}
