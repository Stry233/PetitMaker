/**
 * The backstop around a lazily loaded surface. A chunk that fails to fetch or parse throws while
 * React renders it, and an uncaught render error unmounts the whole app to a blank page, so every
 * `lazy` site is wrapped in one of these: the failure stays local and says what happened.
 *
 * `resetKey` is the surface's own door. Changing it clears the failure, so closing a window and
 * opening it again asks for the chunk once more.
 */
import { Component, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import { buttonMotion, colors, cursors, font, radii, z } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { PANEL_EDGE } from '../design/tokens';
import { useChromeScale } from '../design/scale';

const wrap: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  zIndex: z.toast,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: 'min(92vw, 520px)',
  padding: '10px 12px 10px 16px',
  borderRadius: radii.lg,
  border: PANEL_EDGE,
  background: colors.panelCream,
  color: colors.frameDark,
  fontFamily: font.family,
  ...roleFont('caption'),
  lineHeight: 1.35,
};

const action: CSSProperties = {
  flex: '0 0 auto',
  border: 'none',
  background: colors.surfaceSecondary,
  color: colors.frameDark,
  fontFamily: font.family,
  ...roleFont('small'),
  padding: '6px 12px',
  borderRadius: 999,
  cursor: cursors.clickable,
};

function ChunkNotice() {
  const t = useT();
  const chromeScale = useChromeScale();
  return (
    <div
      role="alert"
      data-testid="chunk-failed-notice"
      // The chrome zoom goes on the fixed element itself; an ancestor zoom skews `left: 50%`.
      style={{ ...wrap, zoom: chromeScale, transform: 'translateX(-50%)' }}
    >
      <span>{t('boot.chunk_failed')}</span>
      <motion.button type="button" style={action} onClick={() => location.reload()} {...buttonMotion}>
        {t('boot.reload')}
      </motion.button>
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** Any value the owning surface changes when it is opened afresh. */
  resetKey?: unknown;
}

export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? <ChunkNotice /> : this.props.children;
  }
}
