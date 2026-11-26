import { cssMotion } from '../../../design/motion';
import { EDITION_COPY, SUPPORTS_CLIPBOARD } from '../../../../platform/build/edition';
import { useState, type CSSProperties, type DragEvent } from 'react';
import { motion } from 'framer-motion';
import { useInteractionProfiles } from '../../../design/input-mode';
import { cursors, radii } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useT } from '../../../../i18n/context';
import { Spinner } from '../../../primitives/Spinner';

export interface ImportDropZoneProps {
  /** Fills the box with the active yellow whatever the pointer does: the page overlay's echo of a
   *  drag over the window. A box taking its own drops fills while a drag is over it. */
  dragOver?: boolean;
  /** Swaps the drop copy for the busy line, with a spinner, while a decode is in flight. */
  busy: boolean;
  /** Click-to-pick a file, wired to Enter/Space too. Omit it (rather than passing a no-op) to leave
   *  the box a passive visual cue: with no handler it is neither a button nor focusable. */
  onClick?: () => void;
  /** The files a drop on the box brings, at least one; the drop goes no further than the box. Omit it
   *  and the box takes no drop of its own. */
  onFiles?: (files: File[]) => void;
  /** Another surface's drop copy in place of the map import's; it then shows no paste hint and no
   *  import note. */
  label?: string;
}

// Three lines of prose about what will and will not import, set as a note to be read rather than noticed.
const noteStyle: CSSProperties = { ...roleFont('note'), color: skin.muted, marginTop: 14, lineHeight: 1.55 };

/** The Import surface's card width, at which both `ImportModal` and `DropImportOverlay` render their `ModalShell`. */
export const IMPORT_CARD_WIDTH = 520;

/**
 * The one drop-a-map surface, shared by Import map and the page drop overlay: a dashed box (the one
 * bordered box here, because the dash says it takes something) that fills with the active yellow
 * while a file is over it, then the import note.
 */
export function ImportDropZone({ dragOver: lit = false, busy, onClick, onFiles, label }: ImportDropZoneProps) {
  const t = useT();
  const press = useInteractionProfiles().row;
  const [over, setOver] = useState(false);
  const dragOver = lit || over;
  const drops = onFiles ? {
    onDragOver: (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
  } : {};
  return (
    <>
      <motion.div
        data-testid="import-drop-zone"
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        {...(onClick ? press : {})}
        onClick={onClick}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
        {...drops}
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
        {SUPPORTS_CLIPBOARD && label === undefined && <div style={{ ...roleFont('note'), marginTop: 6, opacity: 0.8 }}>{t('import.paste_hint')}</div>}
      </motion.div>
      {label === undefined && <div style={noteStyle}>{t(EDITION_COPY.importNote)}</div>}
    </>
  );
}
