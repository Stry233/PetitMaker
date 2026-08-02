import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT, localizedName } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { MAP_LIST } from '../../config/maps';
import { font, colors, inkTint, pressable, modalTitle, cursors, radii, primaryButton } from '../styles';
import { ModalShell } from './ModalShell';
import { iconUrl } from '../../assets/icon-urls';

export interface NewProjectModalProps {
  /** Drives the shared `ModalShell` open/close choreography. Defaults to `true`
   *  so tests can mount the modal directly; App passes `open={showNewProject}`
   *  and keeps the component mounted so the card exit animates as one unit. */
  open?: boolean;
  onSelect: (templateId: string) => void;
  onClose: () => void;
}

const cardStyle: CSSProperties = {
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
};

const titleStyle: CSSProperties = { ...modalTitle };

const gridStyle: CSSProperties = {
  display: 'flex',
  gap: 18,
  justifyContent: 'center',
};

const templateBtnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: 168,
  height: 184,
  borderRadius: 22,
  border: 'none',
  cursor: cursors.clickable,
  background: 'transparent',
  fontSize: 16,
  fontWeight: 800,
  color: colors.frameDark,
  fontFamily: font.family,
  WebkitTapHighlightColor: 'transparent',
};

/** The unsaved-work notice above the map choices, and the way out of it. */
const warnStyle: CSSProperties = {
  // The sentence reads left-aligned against the button on the right; centred, a two-line wrap
  // straggles under a fixed-width button and looks like a mistake.
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
  margin: '0 20px 14px', padding: '10px 16px',
  background: colors.tileYellow, borderRadius: radii.md,
  fontFamily: font.family, fontSize: 15, fontWeight: 800, color: colors.frameDark,
};
const exportBtnStyle: CSSProperties = {
  ...primaryButton, flex: '0 0 auto', padding: '6px 14px', fontSize: 14, whiteSpace: 'nowrap',
};

export function NewProjectModal({ open = true, onSelect, onClose }: NewProjectModalProps) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  // A new map replaces this one, and the browser is the only copy of anything not exported. The
  // undo stack's length at the last export is the mark; anything past it lives only here.
  const exportedAt = useEditorStore((s) => s.exportedAt);
  const executor = useEditorStore((s) => s.commandExecutor);
  const setModal = useEditorStore((s) => s.setModal);
  const edits = executor?.getUndoStackSize() ?? 0;
  const unsaved = edits > 0 && edits !== exportedAt;

  return (
    <ModalShell open={open} onClose={onClose} width={520} cardStyle={cardStyle} ariaLabel={t('modal.new_title')}>
        <div style={titleStyle}>{t('modal.new_title')}</div>
        {unsaved && (
          <div style={warnStyle}>
            <span>{t('modal.new_unsaved')}</span>
            <motion.button
              type="button"
              style={exportBtnStyle}
              onClick={() => { onClose?.(); setModal('exportJson', true); }}
              {...pressable}
            >{t('modal.new_export_first')}</motion.button>
          </div>
        )}
        <div style={gridStyle}>
          {/* Each built-in map (from the maps registry) is shown as its little
              "planet" icon (basename convention `planet-<id>`) above its own
              localized name — no per-map roster or i18n key to maintain here. */}
          {MAP_LIST.map((tmpl) => (
            <motion.button key={tmpl.id} style={templateBtnStyle} onClick={() => onSelect(tmpl.id)} {...pressable}>
              {/* drop-shadow (not a card box-shadow) so the shadow hugs the
                  planet's round silhouette, not the PNG's rectangle. */}
              <img src={iconUrl(`planet-${tmpl.id}`)} alt="" draggable={false} style={{ width: 116, height: 116, objectFit: 'contain', filter: `drop-shadow(0 6px 10px ${inkTint(0.28)})` }} />
              <span>{localizedName(tmpl.name, locale)}</span>
            </motion.button>
          ))}
        </div>
    </ModalShell>
  );
}
