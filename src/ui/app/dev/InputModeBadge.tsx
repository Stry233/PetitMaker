/**
 * A development readout of the device facts touch mode follows: the input mode, the layout shape
 * and the kind of pointer (mouse, pen or touch) that last moved or touched the page. The editor root
 * imports it only behind `import.meta.env.DEV` and only when the page URL carries `?touchdebug=1`,
 * so a production build carries none of it. It wears the dev watermark's treatment and rung and
 * never takes a pointer event.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useCurrentInputMode, useLayoutShape } from '../../design/input-mode';
import { useChromeLayer } from '../../primitives/chrome-layer';
import { font, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { MAP_LABEL } from '../../design/tokens';

const badgeStyle: CSSProperties = {
  position: 'fixed',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: z.unmissable,
  pointerEvents: 'none',
  userSelect: 'none',
  fontFamily: font.family,
  ...roleFont('small'),
  ...MAP_LABEL,
  whiteSpace: 'nowrap',
  display: 'flex',
  gap: 8,
};

/** The pointer kind of the latest pointer event; `pointerover` fires for a still tap, `pointermove` for a hover. */
function useLastPointerType(): string {
  const [kind, setKind] = useState('none');
  useEffect(() => {
    const note = (e: PointerEvent): void => { setKind(e.pointerType || 'unknown'); };
    const options = { capture: true, passive: true } as const;
    window.addEventListener('pointerover', note, options);
    window.addEventListener('pointermove', note, options);
    return () => {
      window.removeEventListener('pointerover', note, options);
      window.removeEventListener('pointermove', note, options);
    };
  }, []);
  return kind;
}

export function InputModeBadge() {
  const mode = useCurrentInputMode();
  const shape = useLayoutShape();
  const pointer = useLastPointerType();
  const layer = useChromeLayer();
  return (
    <div style={{ ...layer, ...badgeStyle }} data-testid="input-mode-badge" aria-hidden>
      <span>{mode}</span>
      <span>{shape}</span>
      <span>{pointer}</span>
    </div>
  );
}
