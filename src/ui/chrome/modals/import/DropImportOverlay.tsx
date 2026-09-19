/**
 * Window-level file import: a dropped file is decoded first, then the shared confirmation card asks
 * before the map is replaced, then the decoded map is installed. Nested drag targets are tracked
 * with a depth counter. The synchronous phase ref prevents stale window-listener closures
 * and duplicate imports. Blur or a hidden tab clears only a hover overlay; pending confirmation and
 * active imports remain intact. `dragover` always prevents browser file navigation.
 */
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CSSProperties } from 'react';
import { useEditorStore } from '../../../../state/store';
import { autosaveWorthy } from '../../../../io/autosave';
import { inspectImportFile, type ImportInspection } from '../../../../io/import-file';
import { getImportFileDeps } from './import-deps';
import { toastImportOutcome } from './import-toast';
import { ImportDropZone, IMPORT_CARD_WIDTH, IMPORT_CARD_PADDING } from './ImportDropZone';
import { ImportConfirm } from './ImportConfirm';
import { ModalShell } from '../../../primitives/ModalShell';
import { springs, exitTransition } from '../../../design/styles';
import { windowCard } from '../../../design/window-skin';

type ReadyInspection = Extract<ImportInspection, { status: 'ready' }>;

/** A drop decodes first (`importing`), then waits for the user's word (`confirm`), then installs (`committing`). */
type DropPhase =
  | { kind: 'idle' }
  | { kind: 'hover' }
  | { kind: 'importing' }
  | { kind: 'confirm'; inspection: ReadyInspection; name: string }
  | { kind: 'committing' };

// Padding lives on the CARD, matching ImportModal's `cardStyle`: a NUMBER `width` plus a
// same-element padding is content-box additive (no `box-sizing:border-box` here), so padding a
// CHILD instead would make this card narrower and shorter than the modal's. `overflow:hidden`
// clips transient overflow while the height morphs.
const cardStyle: CSSProperties = { ...windowCard, padding: IMPORT_CARD_PADDING, position: 'relative', overflow: 'hidden' };

// Visible for the one frame before the layout effect below measures the real height.
const ESTIMATE_HEIGHT = 200;

export function DropImportOverlay() {
  const importModalOpen = useEditorStore((s) => s.modals.import);
  const gridState = useEditorStore((s) => s.gridState);
  const [phase, setPhase] = useState<DropPhase>({ kind: 'idle' });
  const depthRef = useRef(0); // net dragenter - dragleave over the window, incl. all children
  const phaseRef = useRef<DropPhase>(phase); // synchronous mirror of `phase` — see PHASE REF above

  // The one place `phase` is assigned: keeps `phaseRef` and the state in lockstep.
  const setPhaseBoth = useCallback((p: DropPhase) => { phaseRef.current = p; setPhase(p); }, []);

  const open = phase.kind !== 'idle';

  // MORPH HEIGHT (AboutModal's `motionSize` recipe): the height is a MEASURED JS value so ModalShell
  // can spring the box between the hint and confirm shapes. Width never changes — both views share
  // `IMPORT_CARD_WIDTH`. `sizeReady` hard-snaps the first post-mount measurement (nothing has
  // painted at a wrong size to animate FROM) and re-arms on close so a reopen doesn't morph from a
  // stale value.
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [sizeReady, setSizeReady] = useState(false);

  // Measures the CURRENT view via `data-drop-view`, not a ref: framer warns on a ref prop on an
  // AnimatePresence child. An exiting sibling mid-crossfade still carries the data value it was
  // rendered with, so the query cannot pick it up.
  useLayoutEffect(() => {
    if (!open) return;
    const viewKey = phase.kind === 'confirm' ? 'confirm' : 'zone';
    const el = document.querySelector<HTMLElement>(`[data-drop-view="${viewKey}"]`);
    if (!el) return;
    const remeasure = () => setCardHeight(el.scrollHeight);
    remeasure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, phase.kind]);

  useEffect(() => {
    if (open && cardHeight != null && !sizeReady) setSizeReady(true);
  }, [open, cardHeight, sizeReady]);

  useEffect(() => {
    if (!open) setSizeReady(false); // re-arm for the next open
  }, [open]);

  const runImport = useCallback(async (file: File, name: string) => {
    if (phaseRef.current.kind === 'importing') return; // one decode at a time — see REENTRANCY above
    setPhaseBoth({ kind: 'importing' });
    const inspection = await inspectImportFile(file, name);
    if (inspection.status === 'ready') { setPhaseBoth({ kind: 'confirm', inspection, name }); return; }
    toastImportOutcome(inspection);
    setPhaseBoth({ kind: 'idle' });
  }, [setPhaseBoth]);

  /** The user's word: installs the decoded map exactly once, however fast the button is pressed. */
  const commitPending = useCallback(() => {
    const current = phaseRef.current;
    if (current.kind !== 'confirm') return;
    setPhaseBoth({ kind: 'committing' });
    toastImportOutcome(current.inspection.commit(getImportFileDeps()));
    setPhaseBoth({ kind: 'idle' });
  }, [setPhaseBoth]);

  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return; // ignore an in-page text/element drag
      e.preventDefault();
      if (importModalOpen) return; // the modal's own drop zone owns this drag
      depthRef.current += 1;
      if (phaseRef.current.kind === 'idle') setPhaseBoth({ kind: 'hover' });
    };
    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // REQUIRED: without this the browser navigates to the dropped file
    };
    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e) || importModalOpen) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0 && phaseRef.current.kind === 'hover') setPhaseBoth({ kind: 'idle' });
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      if (importModalOpen) return; // avoid importing twice — see file header
      // A decision is already pending or an import is already running — see REENTRANCY above.
      if (phaseRef.current.kind !== 'idle' && phaseRef.current.kind !== 'hover') return;
      const file = e.dataTransfer?.files?.[0];
      if (!file) { setPhaseBoth({ kind: 'idle' }); return; }
      void runImport(file, file.name); // decode on release; the card asks before anything is replaced
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importModalOpen, runImport, setPhaseBoth]);

  // STUCK-OVERLAY RESET — see file header. Only `hover` is eligible: a pending `confirm` or a
  // running `importing` must survive the app losing focus.
  useEffect(() => {
    const resetStuckHover = () => {
      if (phaseRef.current.kind !== 'hover') return;
      depthRef.current = 0;
      setPhaseBoth({ kind: 'idle' });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') resetStuckHover(); };
    window.addEventListener('blur', resetStuckHover);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', resetStuckHover);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [setPhaseBoth]);

  // Feeds `ModalShell`'s `onClose`, which is Escape and the backdrop click both. `passive` below
  // already stops the shell routing either one here outside `confirm`.
  const dismissConfirm = useCallback(() => {
    if (phaseRef.current.kind === 'confirm') setPhaseBoth({ kind: 'idle' });
  }, [setPhaseBoth]);

  return (
    <ModalShell helpTarget={{ page: 'share', anchor: 'share-import' }}
      open={open}
      onClose={dismissConfirm}
      cardStyle={cardStyle}
      motionSize={{ width: IMPORT_CARD_WIDTH, height: cardHeight ?? ESTIMATE_HEIGHT }}
      sizeInstant={!sizeReady}
      maxVw={92}
      // Click-through during hover/importing: the window listeners still own the drag.
      backdropStyle={{ pointerEvents: phase.kind === 'confirm' ? 'auto' : 'none' }}
      lockOverlay={phase.kind === 'confirm'}
      passive={phase.kind !== 'confirm'}
    >
      {(exiting) => (
        // The two views stand in the SAME grid cell, so the exiting one never adds to the flow
        // while it fades. Not `mode="popLayout"`, which does the same job: framer 12's PopChild
        // reads the child's `props.ref` for React 19, and React 18 answers that read with a dev
        // warning on every render. The card's height is measured off the ACTIVE view alone
        // (data-drop-view above), so the overlap never inflates it.
        <div style={{ display: 'grid' }}>
        <AnimatePresence initial={false}>
          {phase.kind === 'confirm' ? (
            <motion.div
              key="confirm"
              data-drop-view="confirm"
              style={{ gridArea: '1 / 1' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              // While the shell itself is closing this view must NOT run its own exit fade: it
              // would race the shell's exit and float free of the card.
              exit={exiting ? undefined : { opacity: 0, pointerEvents: 'none', transition: exitTransition }}
              transition={springs.stiff}
            >
              <ImportConfirm
                preview={phase.inspection.preview}
                name={phase.name}
                replacing={!!gridState && autosaveWorthy(gridState)}
                busy={false}
                onConfirm={commitPending}
                onCancel={dismissConfirm}
              />
            </motion.div>
          ) : (
            <motion.div
              key="zone"
              data-drop-view="zone"
              style={{ gridArea: '1 / 1' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={exiting ? undefined : { opacity: 0, pointerEvents: 'none', transition: exitTransition }}
              transition={springs.stiff}
            >
              {/* No click/drag handlers: the window listeners above own the drag, this is a passive
                  echo. Hover and importing share this ONE mounted view (keyed `zone`, not
                  `phase.kind`), so the empty-map path flips `busy` in place instead of remounting. */}
              <ImportDropZone dragOver busy={phase.kind === 'importing'} />
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      )}
    </ModalShell>
  );
}
