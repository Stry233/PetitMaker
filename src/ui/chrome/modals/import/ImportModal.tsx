import { useCallback, useEffect, useState } from 'react';
import { windowCard, windowTitle } from '../../../design/window-skin';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { importFile } from '../../../../io/import-file';
import { getImportFileDeps } from './import-deps';
import { toastImportOutcome } from './import-toast';
import { ModalShell } from '../../../primitives/ModalShell';
import { ImportDropZone, IMPORT_CARD_WIDTH, IMPORT_CARD_PADDING } from './ImportDropZone';

export function ImportModal() {
  const t = useT();
  const open = useEditorStore((s) => s.modals.import);
  const setModal = useEditorStore((s) => s.setModal);
  const close = (open: boolean) => setModal('import', open);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file: File | Blob, name = '') => {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await importFile(file, name, getImportFileDeps());
      toastImportOutcome(outcome);
      if (outcome.status === 'imported') close(false);
    } finally {
      setBusy(false);
    }
  }, [busy, close]);

  // Accept a pasted image while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void handleFile(file, file.name); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, handleFile]);

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,.json,application/json';
    input.onchange = () => { const f = input.files?.[0]; if (f) void handleFile(f, f.name); };
    input.click();
  };

  return (
    <ModalShell open={open} onClose={() => close(false)} width={IMPORT_CARD_WIDTH} maxVwPct={92} cardStyle={{ ...windowCard, padding: IMPORT_CARD_PADDING }} ariaLabel={t('import.title')}>
      <div style={{ ...windowTitle, marginBottom: 14 }}>{t('import.title')}</div>
      <ImportDropZone
        dragOver={dragOver}
        busy={busy}
        onClick={pickFile}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        // stopPropagation: this is the modal's OWN import surface. `DropImportOverlay`'s window
        // listener also no-ops while the modal is open, so a drop here imports exactly once.
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) void handleFile(f, f.name); }}
      />
    </ModalShell>
  );
}
