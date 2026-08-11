import type { CSSProperties, DragEvent } from 'react';
import { cursors } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { useT } from '../../../../i18n/context';
import { Spinner } from '../../../primitives/Spinner';

export interface ImportDropZoneProps {
  /** Fills the box with the active yellow: a file is over it and letting go will import. */
  dragOver: boolean;
  /** Swaps the drop copy for the busy line, with a spinner, while a decode is in flight. */
  busy: boolean;
  /** Click-to-pick a file, wired to Enter/Space too. OMIT it (rather than passing a no-op) to leave
   *  the box a passive visual cue: with no handler it is neither a button nor focusable. */
  onClick?: () => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
}

// Three lines of prose about what will and will not import, so it is set to be read rather than
// noticed: the smallest type in the window was a size below what the rest of the chrome uses.
const noteStyle: CSSProperties = { fontSize: 12.5, color: skin.muted, marginTop: 14, lineHeight: 1.55 };

/** The Import surface's card geometry, the SSOT both `ImportModal` and `DropImportOverlay` render
 *  their `ModalShell` at. */
export const IMPORT_CARD_WIDTH = 520;
export const IMPORT_CARD_PADDING = '26px 28px 28px';

/**
 * The app's one "drop a map here" surface: a dashed box with the drop copy and a paste hint,
 * followed by the import note. Shared by `ImportModal` (its click-to-pick drop zone) and
 * `DropImportOverlay` (a title-less echo shown while a file is dragged over the window).
 *
 * The dash is the affordance, not decoration — it says "an edge that takes something" where the
 * rest of the interface has no edges at all — so it stays where the repaint dropped every other
 * border.
 *
 * A FILE OVER THE BOX fills it with the active yellow, which is the one thing this interface says
 * "armed" with, everywhere from a chosen mode to a pressed button — so the moment the window is
 * live still looks like the window.
 */
export function ImportDropZone({ dragOver, busy, onClick, onDragOver, onDragLeave, onDrop }: ImportDropZoneProps) {
  const t = useT();
  return (
    <>
      <div
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
          borderRadius: 14, padding: '38px 18px', textAlign: 'center',
          cursor: onClick ? cursors.clickable : cursors.default,
          // The paste hint recedes on the resting cream; on the active yellow a grey would recede
          // out of legibility, so it takes the plate ink instead.
          color: dragOver ? skin.plateInk : skin.muted, fontWeight: 600, transition: 'all 120ms ease',
        }}
      >
        {/* The copy follows the affordance: without an onClick there is nothing to click, and
            the modal's string ends by offering exactly that. Promising it in the drag overlay
            would be an invitation the surface cannot honour. */}
        <div style={{ fontSize: 15, color: skin.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          {busy && <Spinner size={18} />}
          {busy ? t('import.busy') : t(onClick ? 'import.drop' : 'import.drop_only')}
        </div>
        <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>{t('import.paste_hint')}</div>
      </div>
      <div style={noteStyle}>{t('import.note')}</div>
    </>
  );
}
