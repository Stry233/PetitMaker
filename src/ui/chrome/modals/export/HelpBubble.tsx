import { useId, useState, useRef, type CSSProperties } from 'react';
import { ActionButton } from '../../../primitives/ActionButton';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { font, cursors, z, radii, shadows } from '../../../design/styles';
import { framerMotion } from '../../../design/motion';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useT } from '../../../../i18n/context';
import { useChromeScale, useWeightVars } from '../../../design/scale';
import { useFloatingPosition } from '../../../primitives/use-floating-position';
import { useSurfaceScope } from '../../../primitives/surface-scope';
import { useUiPreview } from '../../../design/preview';

const WIDTH = 254;

export function HelpBubble({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const chrome = useChromeScale();
  const weights = useWeightVars();
  const pictured = useUiPreview();
  const floating = useFloatingPosition({ open: open && !pictured, anchor: btnRef, zoom: chrome, width: WIDTH, gap: 6 });
  useSurfaceScope({ open: open && !pictured, root: floating.ref, trigger: btnRef, onClose: () => setOpen(false), outside: true });
  const content = <motion.div ref={floating.ref} id={id} role="tooltip" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={framerMotion('surface.arrive')}
    onClick={() => setOpen(false)} style={{ ...bubble, zoom: pictured ? 1 : chrome, ...weights, ...(pictured ? { position: 'absolute' } : floating.style) }}>{text}</motion.div>;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <ActionButton ref={btnRef} aria-label={t('a11y.help')} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen((v) => !v)} interaction="tap"
        style={{ ...dot, background: open ? skin.ink : skin.line, color: open ? skin.onDark : skin.ink }}>?</ActionButton>
      {open && (pictured ? content : createPortal(content, document.body))}
    </span>
  );
}

const dot: CSSProperties = { width: 17, height: 17, borderRadius: '50%', border: 'none', cursor: cursors.clickable, fontFamily: font.family, ...roleFont('small'), lineHeight: '17px', padding: 0, flex: 'none' };
const bubble: CSSProperties = { position: 'fixed', zIndex: z.popover, width: WIDTH, boxSizing: 'border-box', background: skin.ink, color: skin.onDark, borderRadius: radii.md, padding: '8px 12px', fontFamily: font.family, ...roleFont('caption'), lineHeight: 1.45, boxShadow: shadows.menu, cursor: cursors.clickable };
