/**
 * The look before the leap: a decoded map's picture, title and description, and the word that
 * installs it. Every import path shows this one card, whether the file came through the Import
 * window or was dropped on the page, so a map is never replaced on a drop alone.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import type { ImportPreview } from '../../../../io/import-file';
import { renderThumbnail } from '../../../../canvas/thumbnail';
import { colors, radii, buttonMotion, footerGhost, footerPrimary } from '../../../design/styles';
import { skin, windowTitle } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';

/** Long side of the preview picture, in css px; the card is 520 wide. */
const THUMBNAIL_PX = 440;

const confirmPanel: CSSProperties = {
  background: colors.dangerBg,
  borderRadius: radii.lg,
  padding: '12px 16px',
  ...roleFont('body'),
  color: skin.ink,
};

const dangerReplaceButton: CSSProperties = {
  ...footerPrimary,
  background: colors.statusError,
  color: colors.white,
};

const picture: CSSProperties = {
  display: 'block', width: '100%', maxHeight: 300, objectFit: 'contain',
  borderRadius: radii.md, background: skin.plate, border: `1px solid ${skin.line}`,
};

/** The decoded map as a picture; null until the renderer has drawn it, or where no renderer stands. */
function useThumbnail(preview: ImportPreview): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    void renderThumbnail(preview.state, THUMBNAIL_PX).then((png) => { if (alive) setSrc(png); }).catch(() => {});
    return () => { alive = false; };
  }, [preview]);
  return src;
}

export function ImportConfirm({ preview, name, replacing, busy, onConfirm, onCancel }: {
  preview: ImportPreview;
  /** The file's own name, shown where the map carries no title. */
  name: string;
  /** The current map has content the import would replace. */
  replacing: boolean;
  /** The install is running: the buttons stay put but take no second press. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const thumbnail = useThumbnail(preview);
  const title = preview.notes?.title ?? name;
  return (
    <div data-testid="import-confirm" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={windowTitle}>{t('import.confirm_title')}</div>
      {thumbnail
        ? <img src={thumbnail} alt="" style={picture} />
        : <div aria-hidden style={{ ...picture, height: 160 }} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ ...roleFont('lead'), color: skin.ink, overflowWrap: 'anywhere' }}>{title}</div>
        {preview.notes?.description && (
          <div style={{ ...roleFont('body'), color: skin.plateInk, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.notes.description}</div>
        )}
      </div>
      {replacing && <div role="alert" style={confirmPanel}>{t('import.confirm_replace')}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <motion.button type="button" style={footerGhost} onClick={onCancel} {...buttonMotion}>
          {t('import.drop_cancel')}
        </motion.button>
        <motion.button type="button" style={replacing ? dangerReplaceButton : footerPrimary} aria-busy={busy || undefined} onClick={() => { if (!busy) onConfirm(); }} {...buttonMotion}>
          {t(replacing ? 'import.drop_replace' : 'import.confirm_import')}
        </motion.button>
      </div>
    </div>
  );
}
