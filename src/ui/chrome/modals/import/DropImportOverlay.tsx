/**
 * Window-level file import: a dropped file is decoded first, then the shared confirmation card asks
 * before the map is replaced, then the decoded map is installed. A planet file or a game video goes
 * straight to Import planet with the file handed to it, since a drop on the page is not a map
 * import of its own. Nested drag targets are tracked with a depth counter. Blur or a hidden tab
 * clears only a hover overlay; a pending confirmation and a running import remain intact.
 * `dragover` always prevents browser file navigation.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { CSSProperties } from 'react';
import { useEditorStore } from '../../../../state/store';
import { autosaveWorthy } from '../../../../io/storage/facts';
import { ImportDropZone, IMPORT_CARD_WIDTH } from './ImportDropZone';
import { windowFrame } from '../../../primitives/Window';
import { ImportConfirm } from './ImportConfirm';
import { useImportFlow, type ImportRouting } from './use-import-flow';
import { ModalShell } from '../../../primitives/ModalShell';
import { useSizeGlide } from '../../../primitives/use-size-glide';
import { WindowStep } from '../WindowStep';

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
/** A planet session's canvas is not a map a file can replace; its drags are still claimed, so the
 *  browser never opens the file in place of the app. */
const inSession = () => useEditorStore.getState().planetSession !== null;

const ROUTING: ImportRouting = { map: 'read', planet: 'hand', video: 'hand', unknown: 'read' };

// A content-box card: the padding adds to `IMPORT_CARD_WIDTH` exactly as on the Import window's card.
const cardStyle: CSSProperties = { ...windowFrame, width: IMPORT_CARD_WIDTH, position: 'relative', overflow: 'hidden' };

export function DropImportOverlay() {
  // Import planet's window takes its own drops, a video's among them.
  const importModalOpen = useEditorStore((s) => s.modals.import || s.modals.planetImport);
  const gridState = useEditorStore((s) => s.gridState);
  const [hover, setHover] = useState(false);
  const hoverRef = useRef(false);
  const setHovering = (on: boolean) => { hoverRef.current = on; setHover(on); };
  const depthRef = useRef(0); // net dragenter - dragleave over the window, incl. all children
  const flow = useImportFlow({ routing: ROUTING });
  const { take, idle } = flow;

  const asking = flow.pending !== null;
  const open = hover || flow.busy || asking;
  const body = useSizeGlide<HTMLDivElement>(asking, { axis: 'height', motionId: 'modal.resize' });

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return; // ignore an in-page text/element drag
      e.preventDefault();
      if (importModalOpen || inSession()) return; // the window's own drop zone owns this drag
      depthRef.current += 1;
      if (idle()) setHovering(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // without this the browser navigates to the dropped file
    };
    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e) || importModalOpen) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setHovering(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      setHovering(false);
      if (importModalOpen || inSession() || !idle()) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) void take(file, file.name); // decode on release; the card asks before anything is replaced
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
  }, [importModalOpen, take, idle]);

  // A hover left standing by a drag that ended outside the window goes when the app loses focus.
  useEffect(() => {
    const resetStuckHover = () => {
      if (!hoverRef.current) return;
      depthRef.current = 0;
      setHovering(false);
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') resetStuckHover(); };
    window.addEventListener('blur', resetStuckHover);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', resetStuckHover);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <ModalShell helpTarget={{ page: 'share', anchor: 'share-import' }}
      open={open}
      // Escape and the backdrop answer only the confirmation; `passive` keeps them away otherwise.
      onClose={flow.dismiss}
      cardStyle={cardStyle}
      size="panel"
      // Click-through during hover and decoding: the window listeners still own the drag.
      backdropStyle={{ pointerEvents: asking ? 'auto' : 'none' }}
      lockOverlay={asking}
      passive={!asking}
   >
      <div ref={body.ref} style={{ position: 'relative', ...(body.gliding ? { overflow: 'hidden' } : null) }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {flow.pending ? (
            <WindowStep key="confirm" view="confirm">
              <ImportConfirm
                preview={flow.pending.inspection.preview}
                name={flow.pending.name}
                replacing={!!gridState && autosaveWorthy(gridState)}
                busy={false}
                onConfirm={flow.confirm}
                onCancel={flow.dismiss}
              />
            </WindowStep>
          ) : (
            // A passive echo of the drag: hover and decoding share this one view, so `busy` flips in place.
            <WindowStep key="zone" view="zone">
              <ImportDropZone dragOver busy={flow.busy} />
            </WindowStep>
          )}
        </AnimatePresence>
      </div>
    </ModalShell>
  );
}
