/**
 * Window-level drag-and-drop import: dropping a save file or a share image anywhere over the app
 * imports it without opening the Import modal first. Four states: idle -> hover (dragging a file
 * over the window) -> either an immediate import (empty map) or `confirm` (map has content) ->
 * `importing`. Renders through the same `ModalShell` chrome `ImportModal` does, sharing
 * `IMPORT_CARD_WIDTH`/`IMPORT_CARD_PADDING` from `ImportDropZone.tsx`. Only `confirm` is a modal
 * question, so the shell renders `passive` for the other phases.
 *
 * ENTER/LEAVE TRACKING: a depth COUNTER, not `relatedTarget === null`. `dragleave` fires every time
 * the pointer crosses from a parent into a child element (the bubbling target changes), so a naive
 * "leave = hide" handler flickers as the drag crosses the app's nested layers.
 *
 * DOUBLE-IMPORT GUARD: the ImportModal owns its own drop zone, so this handler no-ops while the
 * modal is open. `dragover` still calls preventDefault() regardless: that line alone is what stops
 * the browser from navigating to the dropped file, and it must fire for every file-carrying drag
 * anywhere on the page.
 *
 * PHASE REF: the window-listener effect below does not depend on `phase` (it would tear down and
 * rebuild all four listeners on every flip), so a closure read of `phase` there is stale. The
 * listeners and `runImport` read the synchronous `phaseRef` instead; only the JSX reads `phase`.
 *
 * REENTRANCY: `onDrop` ignores a file while a decision is pending or an import is running — a
 * second decode would race the first (`loadMap` runs twice, last to resolve wins). `runImport`
 * carries the same guard, so a fast double-click on Replace can't fire it twice.
 *
 * STUCK-OVERLAY RESET: a drag can leave the viewport without ever firing a matching `dragleave`
 * (the pointer exits over OS chrome, another application, or a second monitor), leaving `depthRef`
 * positive and the hint covering the app. `window.blur` and the tab going hidden force the counter
 * to 0 and the phase to `idle`, but ONLY from `hover`: `confirm` is a pending decision and
 * `importing` is in flight, so neither may be torn down by losing focus.
 */
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CSSProperties } from 'react';
import { useEditorStore } from '../../../../state/store';
import { useT } from '../../../../i18n/context';
import { autosaveWorthy } from '../../../../io/autosave';
import { importFile } from '../../../../io/import-file';
import { getImportFileDeps } from './import-deps';
import { toastImportOutcome } from './import-toast';
import { ImportDropZone, IMPORT_CARD_WIDTH, IMPORT_CARD_PADDING } from './ImportDropZone';
import { ModalShell } from '../../../primitives/ModalShell';
import {
  colors, springs, exitTransition, radii, buttonMotion, footerGhost, footerPrimary,
} from '../../../design/styles';
import { windowCard, windowTitle } from '../../../design/window-skin';

type DropPhase =
  | { kind: 'idle' }
  | { kind: 'hover' }
  | { kind: 'confirm'; file: File; name: string }
  | { kind: 'importing' };

// Padding lives on the CARD, matching ImportModal's `cardStyle`: a NUMBER `width` plus a
// same-element padding is content-box additive (no `box-sizing:border-box` here), so padding a
// CHILD instead would make this card narrower and shorter than the modal's. `position:relative`
// lets `AnimatePresence mode="popLayout"` (below) absolutely-position the EXITING view against
// this card; `overflow:hidden` clips transient overflow while the height morphs.
const cardStyle: CSSProperties = { ...windowCard, padding: IMPORT_CARD_PADDING, position: 'relative', overflow: 'hidden' };

// Visible for the one frame before the layout effect below measures the real height.
const ESTIMATE_HEIGHT = 200;

const confirmPanel: CSSProperties = {
  background: colors.dangerBg,
  borderRadius: radii.lg,
  padding: '18px 20px',
};

const dangerReplaceButton: CSSProperties = {
  ...footerPrimary,
  background: colors.statusError,
  color: colors.white,
};

export function DropImportOverlay() {
  const t = useT();
  const importModalOpen = useEditorStore((s) => s.modals.import);
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
    if (phaseRef.current.kind === 'importing') return; // one import at a time — see REENTRANCY above
    setPhaseBoth({ kind: 'importing' });
    const outcome = await importFile(file, name, getImportFileDeps());
    toastImportOutcome(outcome);
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
      if (phaseRef.current.kind === 'confirm' || phaseRef.current.kind === 'importing') return;
      const file = e.dataTransfer?.files?.[0];
      if (!file) { setPhaseBoth({ kind: 'idle' }); return; }
      const gridState = useEditorStore.getState().gridState;
      if (gridState && autosaveWorthy(gridState)) {
        setPhaseBoth({ kind: 'confirm', file, name: file.name });
      } else {
        void runImport(file, file.name); // empty map: import on release
      }
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
    <ModalShell
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
        // popLayout: framer measures the EXITING view's last box and holds it out of flow, so the
        // entering view lays out normally in the card's padded content box instead of stacking.
        <AnimatePresence mode="popLayout" initial={false}>
          {phase.kind === 'confirm' ? (
            <motion.div
              key="confirm"
              data-drop-view="confirm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              // While the shell itself is closing this view must NOT run its own exit fade: it
              // would race the shell's exit and float free of the card.
              exit={exiting ? undefined : { opacity: 0, pointerEvents: 'none', transition: exitTransition }}
              transition={springs.stiff}
            >
              <div style={confirmPanel}>
                <div style={windowTitle}>{t('import.drop_replace_title', { name: phase.name })}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                  <motion.button type="button" style={footerGhost} onClick={dismissConfirm} {...buttonMotion}>
                    {t('import.drop_cancel')}
                  </motion.button>
                  <motion.button
                    type="button"
                    style={dangerReplaceButton}
                    onClick={() => void runImport(phase.file, phase.name)}
                    {...buttonMotion}
                  >
                    {t('import.drop_replace')}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="zone"
              data-drop-view="zone"
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
      )}
    </ModalShell>
  );
}
