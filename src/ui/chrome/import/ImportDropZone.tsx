import type { CSSProperties, DragEvent } from 'react';
import { colors, inkTint, cursors } from '../../styles';
import { useT } from '../../../i18n/context';
import { Spinner } from '../../Spinner';

export interface ImportDropZoneProps {
  /** Highlights the box in `colors.importAccent` with a tinted fill. */
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

const noteStyle: CSSProperties = { fontSize: 11, color: colors.textSecondary, marginTop: 12, lineHeight: 1.5 };

/** The Import surface's card geometry, the SSOT both `ImportModal` and `DropImportOverlay` render
 *  their `ModalShell` at. */
export const IMPORT_CARD_WIDTH = 520;
export const IMPORT_CARD_PADDING = '26px 28px 28px';

/**
 * The app's one "drop a map here" surface: a dashed box (`inkTint(0.25)` at rest,
 * `colors.importAccent` plus a tinted fill while a file is over it) with the drop copy and a paste
 * hint, followed by the import note. Shared by `ImportModal` (its click-to-pick drop zone) and
 * `DropImportOverlay` (a title-less echo shown while a file is dragged over the window).
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
          border: `2px dashed ${dragOver ? colors.importAccent : inkTint(0.25)}`,
          background: dragOver ? 'rgba(142,123,214,0.06)' : inkTint(0.02),
          borderRadius: 14, padding: '38px 18px', textAlign: 'center',
          cursor: onClick ? cursors.clickable : cursors.default,
          color: colors.textSecondary, fontWeight: 600, transition: 'all 120ms ease',
        }}
      >
        {/* The copy follows the affordance: without an onClick there is nothing to click, and
            the modal's string ends by offering exactly that. Promising it in the drag overlay
            would be an invitation the surface cannot honour. */}
        <div style={{ fontSize: 15, color: colors.frameDark, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          {busy && <Spinner size={18} />}
          {busy ? t('import.busy') : t(onClick ? 'import.drop' : 'import.drop_only')}
        </div>
        <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>{t('import.paste_hint')}</div>
      </div>
      <div style={noteStyle}>{t('import.note')}</div>
    </>
  );
}
