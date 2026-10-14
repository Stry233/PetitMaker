import { cssMotion } from '../../../design/motion';
import { EDITION_COPY, SUPPORTS_CLIPBOARD } from '../../../../platform/build/edition';
import type { CSSProperties, DragEvent } from 'react';
import { cursors, radii } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useT } from '../../../../i18n/context';
import { Spinner } from '../../../primitives/Spinner';

export interface ImportDropZoneProps {
  /** Fills the box with the active yellow: a file is over it and letting go will import. */
  dragOver: boolean;
  /** Swaps the drop copy for the busy line, with a spinner, while a decode is in flight. */
  busy: boolean;
  /** Click-to-pick a file, wired to Enter/Space too. Omit it (rather than passing a no-op) to leave
   *  the box a passive visual cue: with no handler it is neither a button nor focusable. */
  onClick?: () => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  /** Another surface's drop copy in place of the map import's; it then shows no paste hint and no
   *  import note. */
  label?: string;
}

// Three lines of prose about what will and will not import, so it is set to be read rather than
// noticed: the smallest type in the window was a size below what the rest of the chrome uses.
const noteStyle: CSSProperties = { ...roleFont('caption'), color: skin.muted, marginTop: 14, lineHeight: 1.55 };

/** The Import surface's card geometry, the SSOT both `ImportModal` and `DropImportOverlay` render
 *  their `ModalShell` at. */
export const IMPORT_CARD_WIDTH = 520;

/**
 * The one drop-a-map surface, shared by Import map and the page drop overlay: a dashed box (the one
 * bordered box here, because the dash says it takes something) that fills with the active yellow
 * while a file is over it, then the import note.
 */
export function ImportDropZone({ dragOver, busy, onClick, onDragOver, onDragLeave, onDrop, label }: ImportDropZoneProps) {
  const t = useT();
  return (
    <>
      <div
        data-testid="import-drop-zone"
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? skin.ink : skin.line}`,
          background: dragOver ? skin.active : skin.inset,
          borderRadius: radii.field, padding: '40px 18px', textAlign: 'center',
          cursor: onClick ? cursors.clickable : cursors.default,
          // The paste hint recedes on the resting cream; on the active yellow a grey would recede
          // out of legibility, so it takes the plate ink instead.
          color: dragOver ? skin.plateInk : skin.muted, transition: cssMotion('control.drop', ['background-color', 'color', 'border-color']),
        }}
     >
        {/* The copy follows the affordance: without an onClick there is nothing to click, and
            the modal's string ends by offering exactly that. Promising it in the drag overlay
            would be an invitation the surface cannot honour. */}
        <div style={{ ...roleFont('head'), color: skin.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          {busy && <Spinner size={18} />}
          {busy ? t('import.busy') : label ?? t(EDITION_COPY.importPick ?? (onClick ? 'import.drop' : 'import.drop_only'))}
        </div>
        {SUPPORTS_CLIPBOARD && label === undefined && <div style={{ ...roleFont('caption'), marginTop: 6, opacity: 0.8 }}>{t('import.paste_hint')}</div>}
      </div>
      {label === undefined && <div style={noteStyle}>{t(EDITION_COPY.importNote)}</div>}
    </>
  );
}
