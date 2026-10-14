import { SUPPORTS_CLIPBOARD, SUPPORTS_JSON_FILES, SUPPORTS_VIDEO_IMPORT } from '../../../../platform/build/edition';
import { useEffect, useState, useRef } from 'react';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { autosaveWorthy } from '../../../../io/storage/facts';
import { VIDEO_ACCEPT } from '../../../../io/import/facts';
import { ImportConfirm } from './ImportConfirm';
import { ImportRedirect } from './ImportRedirect';
import { useImportFlow, type ImportRouting } from './use-import-flow';
import { useHandedImport } from './use-handed-import';
import { useWindow, type WindowProps } from '../use-window';
import { ModalShell } from '../../../primitives/ModalShell';
import { ImportDropZone, IMPORT_CARD_WIDTH, type ImportDropZoneProps } from './ImportDropZone';
import { WindowHeader, windowFrame } from '../../../primitives/Window';

/** What the picker offers: map images, then map and planet files where JSON is read, then game
 *  videos where they are read, so the redirect card can answer a picked one. */
const PICKER_ACCEPT = [
  'image/png,image/jpeg,image/webp',
  ...(SUPPORTS_JSON_FILES ? ['.json,application/json'] : []),
  ...(SUPPORTS_VIDEO_IMPORT ? [VIDEO_ACCEPT] : []),
].join(',');

/** The Import window's body: its title over the shared drop zone. Exported for the Help Center's
 *  import figure, which poses the same body inside the modal's own card. */
export function ImportCardBody({ onClose, ...props }: ImportDropZoneProps & { onClose: () => void }) {
  const t = useT();
  return (
    <>
      <WindowHeader title={t('import.title')} reserve close={{ label: t('hint.close'), onPress: onClose }} style={{ marginBottom: 14 }} />
      <ImportDropZone {...props} />
    </>
  );
}

const ROUTING: ImportRouting = { map: 'read', planet: 'card', video: 'card', unknown: 'read' };

export function ImportModal(props: WindowProps) {
  const t = useT();
  const { open, close } = useWindow('import', props);
  return (
    <ModalShell helpTarget={{ page: 'share', anchor: 'share-import' }} open={open} onClose={close} size="panel" width={IMPORT_CARD_WIDTH} cardStyle={{ ...windowFrame, overflowY: 'auto' }} ariaLabel={t('import.title')}>
      <ImportBody open={open} onClose={close} />
    </ModalShell>
  );
}

function ImportBody({ open, onClose }: { open: boolean; onClose: () => void }) {
  const gridState = useEditorStore((s) => s.gridState);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // Decoding never installs anything: the confirmation card is where the map is replaced.
  const flow = useImportFlow({ routing: ROUTING, onCommitted: onClose });
  const { take } = flow;

  // A map handed over from Import planet's window is read as if it had been dropped here.
  useHandedImport('map', open, (file) => { void take(file, file.name); });

  // Accept a pasted image while the modal is open.
  useEffect(() => {
    if (!SUPPORTS_CLIPBOARD || !open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void take(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, take]);

  const pickFile = () => {
    if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click(); }
  };

  return (
    <>
      <input ref={inputRef} type="file" hidden accept={PICKER_ACCEPT} data-testid="import-file" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void take(f, f.name); }} />
      {flow.redirect ? (
        <ImportRedirect hand={flow.redirect} onCancel={flow.dismiss} />
      ) : flow.pending ? (
        <ImportConfirm
          preview={flow.pending.inspection.preview}
          name={flow.pending.name}
          replacing={!!gridState && autosaveWorthy(gridState)}
          busy={flow.busy}
          onConfirm={flow.confirm}
          onCancel={flow.dismiss}
        />
      ) : <ImportCardBody
        onClose={onClose}
        dragOver={dragOver}
        busy={flow.busy}
        onClick={pickFile}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        // stopPropagation: this is the modal's own import surface, and the page-level overlay stands
        // aside while it is open, so a drop here imports exactly once.
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) void take(f, f.name); }}
      />}
    </>
  );
}
