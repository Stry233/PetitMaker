import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT, localizedName } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { MAP_LIST } from '../../config/maps';
import { font, colors, inkTint, pressable, modalTitle, cursors } from '../styles';
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

export function NewProjectModal({ open = true, onSelect, onClose }: NewProjectModalProps) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);

  return (
    <ModalShell open={open} onClose={onClose} width={420} cardStyle={cardStyle} ariaLabel={t('modal.new_title')}>
        <div style={titleStyle}>{t('modal.new_title')}</div>
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
