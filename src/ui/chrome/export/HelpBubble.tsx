// A small "[?]" help bubble: a circular toggle that reveals a short dark tooltip (the same look as
// the generation submenu's recipe-help). The tooltip is FIXED-positioned (anchored to the button via
// getBoundingClientRect, clamped to the viewport) so the modal's overflow:hidden never clips it.
import { useState, useRef, useLayoutEffect, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { colors, font, springs, inkTint, cursors } from '../../styles';
import { useChromeScale } from '../../menu/scale';
import { ClickCatcher, clampLeft } from '../ClickCatcher';

const WIDTH = 230;

export function HelpBubble({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const chrome = useChromeScale();

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Clamp in VISUAL px (the bubble renders at WIDTH x the modal's css zoom), then divide
    // the zoom back out of the stored css coordinates (they live inside the zoomed subtree).
    const left = clampLeft(r.left, WIDTH, chrome);
    setPos({ left: left / chrome, top: (r.bottom + 6) / chrome });
  }, [open, chrome]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <motion.button ref={btnRef} type="button" aria-label="help" onClick={() => setOpen((v) => !v)} whileTap={{ scale: 0.9 }}
        style={{ ...dot, background: open ? colors.frameDark : '#CFC7B6', color: open ? colors.white : colors.frameDark }}>?</motion.button>
      {open && pos && (
        <>
          <ClickCatcher onDismiss={() => setOpen(false)} />
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={springs.stiff}
            onClick={() => setOpen(false)}
            style={{ ...bubble, left: pos.left, top: pos.top }}>{text}</motion.div>
        </>
      )}
    </span>
  );
}

const dot: CSSProperties = { width: 17, height: 17, borderRadius: '50%', border: 'none', cursor: cursors.clickable, fontFamily: font.family, fontWeight: 800, fontSize: 11, lineHeight: '17px', padding: 0, flex: 'none' };
const bubble: CSSProperties = { position: 'fixed', zIndex: 301, width: WIDTH, background: colors.frameDark, color: colors.white, borderRadius: 12, padding: '9px 12px', fontFamily: font.family, fontWeight: 600, fontSize: 12, lineHeight: 1.45, boxShadow: `0 6px 18px ${inkTint(0.32)}`, cursor: cursors.clickable };
