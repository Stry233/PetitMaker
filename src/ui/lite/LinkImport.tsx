/**
 * The confirmation for a map the page was opened with through a link
 * (`editor/export/host-deliveries.ts:HOST_MAP_LINK`), which `editor/session/link-import.ts` reads and installs.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../state/store';
import { useT } from '../../i18n/context';
import { autosaveWorthy } from '../../io/storage/facts';
import { createLinkImport } from '../../editor/session/link-import';
import { ModalShell } from '../primitives/ModalShell';
import { windowColumn, windowFrame } from '../primitives/Window';
import { ImportConfirm } from '../chrome/modals/import/ImportConfirm';
import { IMPORT_CARD_WIDTH } from '../chrome/modals/import/ImportDropZone';
import { HOST_MAP_LINK } from '../../editor/export/host-deliveries';

export function LinkImport() {
  const t = useT();
  const gridState = useEditorStore((s) => s.gridState);
  const [link] = useState(() => createLinkImport(() => HOST_MAP_LINK?.arriving() ?? null));
  const pending = useSyncExternalStore(link.subscribe, link.snapshot);
  // The shell stands the saved-session offer in a layout effect, so it stands by the time this runs.
  useEffect(() => link.watch(), [link]);
  return (
    <ModalShell helpTarget={{ page: 'share' }} open={pending !== null} onClose={link.dismiss} cardStyle={windowFrame} size="panel" width={IMPORT_CARD_WIDTH} ariaLabel={t('import.confirm_title')}>
      {pending && <div style={windowColumn}>
        <ImportConfirm
          preview={pending.inspection.preview}
          name={pending.name}
          replacing={!!gridState && autosaveWorthy(gridState)}
          busy={false}
          onConfirm={link.confirm}
          onCancel={link.dismiss}
        />
      </div>}
    </ModalShell>
  );
}
