import { IS_LITE } from '../../../../core/runtime/edition';
import { useCallback, useEffect, useState, useRef } from 'react';
import { windowCard, windowTitle } from '../../../design/window-skin';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { autosaveWorthy } from '../../../../io/autosave';
import { inspectImportFile, type ImportInspection } from '../../../../io/import-file';
import { ImportConfirm } from './ImportConfirm';
import { getImportFileDeps } from './import-deps';
import { toastImportOutcome } from './import-toast';
import { ModalShell } from '../../../primitives/ModalShell';
import { ImportDropZone, IMPORT_CARD_WIDTH, IMPORT_CARD_PADDING, type ImportDropZoneProps } from './ImportDropZone';

/** The Import window's body: its title over the shared drop zone. Exported for the Help Center's
 *  import figure, which poses the same body inside the modal's own card. */
export function ImportCardBody(props: ImportDropZoneProps) {
  const t = useT();
  return (
    <>
      <div style={{ ...windowTitle, marginBottom: 14 }}>{t('import.title')}</div>
      <ImportDropZone {...props} />
    </>
  );
}

export function ImportModal() {
  const t = useT();
  const open = useEditorStore((s) => s.modals.import);
  const setModal = useEditorStore((s) => s.setModal);
  const gridState = useEditorStore((s) => s.gridState);
  const close = (open: boolean) => setModal('import', open);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /** A decoded file waiting for the user's word; the drop zone gives way to its card. */
  const [pending, setPending] = useState<{ inspection: Extract<ImportInspection, { status: 'ready' }>; name: string } | null>(null);
  useEffect(() => { if (!open) setPending(null); }, [open]);

  // Decoding never installs anything: the card that follows is where the map is replaced.
  const handleFile = useCallback(async (file: File | Blob, name = '') => {
    if (busy || pending) return;
    setBusy(true);
    try {
      const inspection = await inspectImportFile(file, name);
      if (inspection.status === 'ready') setPending({ inspection, name });
      else toastImportOutcome(inspection);
    } finally {
      setBusy(false);
    }
  }, [busy, pending]);

  const confirm = () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      toastImportOutcome(pending.inspection.commit(getImportFileDeps()));
    } finally {
      setBusy(false);
      setPending(null);
      close(false);
    }
  };

  // Accept a pasted image while the modal is open.
  useEffect(() => {
    if (IS_LITE || !open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void handleFile(file, file.name); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, handleFile]);

  const pickFile = () => {
    if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click(); }
  };

  return (
    <ModalShell open={open} onClose={() => close(false)} width={IMPORT_CARD_WIDTH} maxVwPct={92} maxVh={92} cardStyle={{ ...windowCard, padding: IMPORT_CARD_PADDING, overflowY: 'auto' }} ariaLabel={t('import.title')}>
      <input ref={inputRef} type="file" hidden accept={IS_LITE ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,.json,application/json'} onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void handleFile(f, f.name); }} />
      {pending ? (
        <ImportConfirm
          preview={pending.inspection.preview}
          name={pending.name}
          replacing={!!gridState && autosaveWorthy(gridState)}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      ) : <ImportCardBody
        dragOver={dragOver}
        busy={busy}
        onClick={pickFile}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        // stopPropagation: this is the modal's OWN import surface. `DropImportOverlay`'s window
        // listener also no-ops while the modal is open, so a drop here imports exactly once.
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) void handleFile(f, f.name); }}
      />}
    </ModalShell>
  );
}
