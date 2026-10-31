import { createContext, useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { PresenceContext, animate, usePresence, useReducedMotionConfig, type AnimationPlaybackControls } from 'framer-motion';
import { framerMotion } from '../design/motion';
import type { MotionId } from '../design/motion/registry';

interface DisclosureProps {
  children: ReactNode;
  /** Omit inside AnimatePresence; pass a boolean to retain mounted form state. */
  open?: boolean;
  motionId?: MotionId;
  spaceBefore?: number;
  spaceAfter?: number;
  testId?: string;
  style?: CSSProperties;
  inline?: boolean;
}

const RowGap = createContext(0);

/** Each departing row owns its gap; the final trailing gap stays outside the stack's measured height. */
export function DisclosureStack({ gap, children }: { gap: number; children: ReactNode }) {
  return <RowGap.Provider value={gap}>
    <div style={{ display: 'flow-root', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: -gap }}>{children}</div>
    </div>
  </RowGap.Provider>;
}

/**
 * Spacing is part of the moving content; only a fully open disclosure releases its clip. The frame
 * travels between heights read with `offsetHeight`, in its own px, so it lands on its content under
 * any CSS zoom; height and opacity are written here, never by React.
 */
export function Disclosure({ children, open, motionId = 'panel.detail.unfold', spaceBefore = 0, spaceAfter, testId, style, inline = false }: DisclosureProps) {
  const gap = useContext(RowGap);
  const [present, safeToRemove] = usePresence();
  const reduced = useReducedMotionConfig() === true;
  const shown = present && open !== false;
  const frameRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const glide = useRef<AnimationPlaybackControls | null>(null);
  const seated = useRef(false);
  // A disclosure mounted inside AnimatePresence arrives from closed, unless it mounts with the presence
  // itself under `initial={false}`; one given `open` stands as it is.
  const presence = useContext(PresenceContext);
  const arrives = useRef(open === undefined && presence?.initial !== false);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const body = bodyRef.current;
    if (!frame || !body) return;
    const arriving = !seated.current && arrives.current;
    const from = seated.current ? frame.offsetHeight : arriving ? 0 : null;
    seated.current = true;
    glide.current?.stop();
    glide.current = null;
    const rest = () => {
      frame.style.height = shown ? '' : '0px';
      frame.style.opacity = shown ? '' : '0';
      frame.style.overflow = shown ? 'visible' : 'hidden';
    };
    if (from === null || reduced) { rest(); return; }
    const to = shown ? body.offsetHeight : 0;
    frame.style.overflow = 'hidden';
    const fromOpacity = arriving ? 0 : frame.style.opacity === '' ? 1 : Number(frame.style.opacity);
    const toOpacity = shown ? 1 : 0;
    if (arriving) frame.style.opacity = '0';
    // One number drives both styles: an element animation commits its final values a frame after it
    // resolves, which would pin the frame at the height measured on arrival and let grown content
    // spill over the rows below.
    const controls = animate(0, 1, {
      ...framerMotion(motionId),
      onUpdate: (p: number) => {
        frame.style.height = `${from + (to - from) * p}px`;
        frame.style.opacity = String(Math.min(1, Math.max(0, fromOpacity + (toOpacity - fromOpacity) * p)));
      },
    });
    glide.current = controls;
    void controls.then(() => {
      if (glide.current !== controls) return;
      glide.current = null;
      rest();
      if (!shown) safeToRemove?.();
    });
  }, [shown, reduced, motionId, safeToRemove]);

  // A departure that lands at once is released here: AnimatePresence registers the exit in a passive
  // effect, after layout effects have run, and ignores a release that comes before it.
  useEffect(() => { if (!present && glide.current === null) safeToRemove?.(); }, [present, safeToRemove]);
  useLayoutEffect(() => () => { glide.current?.stop(); }, []);

  const Frame = inline ? 'span' : 'div';
  const Body = inline ? 'span' : 'div';
  return (
    <Frame
      ref={frameRef as Ref<HTMLDivElement & HTMLSpanElement>}
      {...(shown ? {} : { inert: '' })}
      data-testid={testId}
      aria-hidden={!shown || undefined}
      style={{ display: 'block', flex: '0 0 auto', overflow: 'hidden', ...style, pointerEvents: shown ? undefined : 'none' }}
    >
      <RowGap.Provider value={0}>
        <Body ref={bodyRef as Ref<HTMLDivElement & HTMLSpanElement>} style={{ display: 'flow-root', paddingTop: spaceBefore, paddingBottom: spaceAfter ?? gap }}>{children}</Body>
      </RowGap.Provider>
    </Frame>
  );
}
