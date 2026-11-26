import { SUPPORTS_CLIPBOARD } from '../../../../platform/build/edition';
import { useEffect } from 'react';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { autosaveWorthy } from '../../../../io/storage/facts';
import { IMPORT_ACCEPT } from '../../../../io/import/facts';
import { ImportConfirm } from './ImportConfirm';
import { ImportRedirect } from './ImportRedirect';
import { useImportFlow, type ImportRouting } from './use-import-flow';
import { useHandedImport } from './use-handed-import';
import { useWindow, type WindowProps } from '../use-window';
import { ModalShell } from '../../../primitives/ModalShell';
import { ImportDropZone, IMPORT_CARD_WIDTH, type ImportDropZoneProps } from './ImportDropZone';
import { WindowBody, WindowHeader, windowFrame } from '../../../primitives/Window';
import { useFilePick } from '../../../primitives/use-file-pick';

/** The Import window's body: its title over the shared drop zone. Exported for the Help Center's
 *  import figure, which poses the same body inside the modal's own card. */
function ImportCardBody({ onClose, ...props }: ImportDropZoneProps & { onClose: () => void }) {
  const t = useT();
  return (
    <>
      <WindowHeader title={t('import.title')} reserve close={{ label: t('hint.close'), onPress: onClose }} style={{ marginBottom: 14 }} />
      <WindowBody>
        <ImportDropZone {...props} />
      </WindowBody>
    </>
  );
}

const ROUTING: ImportRouting = { map: 'read', planet: 'card', video: 'card', unknown: 'read' };

export function ImportModal(props: WindowProps) {
  const t = useT();
  const { open, close } = useWindow('import', props);
  return (
    <ModalShell helpTarget={{ page: 'share', anchor: 'share-import' }} open={open} onClose={close} size="panel" width={IMPORT_CARD_WIDTH} cardStyle={windowFrame} ariaLabel={t('import.title')}>
      <ImportBody open={open} onClose={close} />
    </ModalShell>
  );
}

function ImportBody({ open, onClose }: { open: boolean; onClose: () => void }) {
  const gridState = useEditorStore((s) => s.gridState);
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

  const file = useFilePick({ accept: IMPORT_ACCEPT, onFile: (f) => { void take(f, f.name); } });

  return (
    <>
      <input {...file.input} data-testid="import-file" />
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
        busy={flow.busy}
        onClick={file.pick}
        // The box keeps its drop: the page-level overlay stands aside while this window is open, so a
        // drop here imports exactly once.
        onFiles={([f]) => { void take(f!, f!.name); }}
      />}
    </>
  );
}
