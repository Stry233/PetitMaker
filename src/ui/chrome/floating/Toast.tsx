import { framerMotion } from '../../design/motion';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useChromeLayer } from '../../primitives/chrome-layer';
import { NOTICE_CONTROL, useNoticeZoom } from '../../primitives/NoticeBar';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { font, radii, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useEditorStore } from '../../../state/store';
import { anyModalOpen } from '../../../state/slices/shell';
import { useT } from '../../../i18n/context';
import type { ValidationError } from '../../../core/model/types';
import { setToastPresenter, type ToastType } from '../../../platform/channels/toast-bus';
import { TOAST_BAND_TOP, UPRIGHT_TOAST_TOP, bandCentre, bandMaxWidth, bandTop, fromChromePx } from './toast-band';
import { useLayoutShape } from '../../design/input-mode';
import { useGlidingChromeScale, useViewportSize } from '../../design/scale';
import { refusalKey, ruleToast } from '../../../i18n/terms/rule-copy';
import { PANEL_EDGE, ERROR, ACCENT, SUCCESS, PLATE, FRAME_INK, ON_DARK } from '../../design/tokens';
import { useMorph } from '../../primitives/morph';

const TOAST_DURATION = 3000;

/** Where the band stands, its places written in chrome px and converted to the toasts' own by `ratio`
 *  (`toast-band.ts:fromChromePx`); upright, under the frame's top row. */
const containerStyle = (ratio: number, upright: boolean, overWindow: boolean): CSSProperties => ({
  position: 'fixed',
  top: fromChromePx(upright ? UPRIGHT_TOAST_TOP : bandTop(TOAST_BAND_TOP), ratio),
  // Centred over the work: a docked panel owns a strip at one side of the window, and a notice about
  // what just happened on the map belongs over the map, upright between the frame's side margins.
  left: bandCentre(ratio, upright),
  transform: 'translateX(-50%)',
  // A toast about the map stands under a window; one a window's own work posted stands over it.
  zIndex: overWindow ? z.toast : z.notice,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  pointerEvents: 'none',
});


interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
  count: number;
  /** Posted while a window stood, so it reports what was done in that window. */
  overWindow: boolean;
}

function accentColor(type: ToastType): string {
  return type === 'error' ? ERROR
    : type === 'warning' ? ACCENT
    : SUCCESS;
}

const toastStyle: CSSProperties = {
  background: PLATE,
  color: FRAME_INK,
  ...roleFont('menu'),
  // A toast wraps at `maxWidth`, so the leading is part of the token rather than the browser's.
  lineHeight: '150%',
  fontFamily: font.family,
  padding: '10px 18px',
  borderRadius: radii.card,
  // A card standing on the map meets it with the panel hairline and casts nothing (`tokens.ts`).
  border: PANEL_EDGE,
  boxShadow: 'none',
  maxWidth: 420,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

// Colored status dot — carries the type while the text stays dark/legible.
const dotStyle = (type: ToastType): CSSProperties => ({
  width: 9,
  height: 9,
  borderRadius: '50%',
  background: accentColor(type),
  flexShrink: 0,
});

const badgeStyle = (type: ToastType): CSSProperties => ({
  background: accentColor(type),
  color: ON_DARK,
  ...roleFont('caption'),
  fontFamily: font.family,
  borderRadius: radii.pill,
  padding: '2px 6px',
  minWidth: 20,
  textAlign: 'center',
  lineHeight: '18px',
});

/** The toast's own face: card, status dot, text and repeat badge. No timers, no presence:
 *  `ToastContainer` plays it live and the Help Center's figure stands it still (the one motion
 *  here, the badge's pop, re-keys on the count, so a static count never moves). */
export function ToastFace({ text, type, count }: { text: string; type: ToastType; count: number }) {
  return (
    <div data-testid="toast" style={toastStyle}>
      <span style={dotStyle(type)} />
      {text}
      {count > 1 && (
        <motion.span
          key={count}
          style={badgeStyle(type)}
          initial={{ scale: 1.4 }}
          animate={{ scale: 1 }}
          transition={framerMotion('surface.arrive')}
        >
          {count}
        </motion.span>
      )}
    </div>
  );
}

let nextId = 0;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // The list as last set, read by the presenter, which schedules each toast's expiry outside the
  // state updater (an updater may run twice).
  const listRef = useRef<ToastMessage[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const eventBus = useEditorStore((s) => s.eventBus);
  const t = useT();

  const publish = useCallback((next: ToastMessage[]) => {
    const timers = timersRef.current;
    for (const [id, timer] of timers) {
      if (!next.some((toast) => toast.id === id)) { clearTimeout(timer); timers.delete(id); }
    }
    listRef.current = next;
    setToasts(next);
  }, []);

  const addToast = useCallback((text: string, type: ToastType = 'error') => {
    const prev = listRef.current;
    const overWindow = anyModalOpen(useEditorStore.getState());
    const existing = prev.find((toast) => toast.text === text && toast.type === type);
    const id = existing?.id ?? nextId++;
    const timers = timersRef.current;
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      publish(listRef.current.filter((toast) => toast.id !== id));
    }, TOAST_DURATION));
    publish(existing
      ? prev.map((toast) => (toast.id === id ? { ...toast, count: toast.count + 1, overWindow: toast.overWindow || overWindow } : toast))
      : [...prev.slice(-2), { id, text, type, count: 1, overWindow }]);
  }, [publish]);

  useEffect(() => setToastPresenter(addToast), [addToast]);
  useEffect(() => {
    const timers = timersRef.current;
    return () => { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); };
  }, []);

  useEffect(() => {
    const handler = ({ errors }: { errors: ValidationError[] }) => {
      if (errors.length === 0) return;
      const first = errors[0]!;
      const message = ruleToast(t, refusalKey(first.message), first.messageParams);
      addToast(message, 'error');
    };
    eventBus.on('validation-failed', handler);
    return () => eventBus.off('validation-failed', handler);
  }, [eventBus, t, addToast]);

  // The band reads the scale and the window only while it holds a toast or plays the last one out.
  const [banded, setBanded] = useState(false);
  if (toasts.length > 0 && !banded) setBanded(true);
  const emptied = useCallback(() => setBanded(false), []);
  return banded ? <ToastBand toasts={toasts} onEmptied={emptied} /> : null;
}

function ToastBand({ toasts, onEmptied }: { toasts: ToastMessage[]; onEmptied: () => void }) {
  // Touch mode draws the refusals at the band's zoom (`NoticeBar.tsx:useNoticeZoom`). From `left: 50%`
  // a lifted card would only have the half window to its right, so it is held at its words' width
  // and never past the window less a docked panel's strip and the side margins: upright, the
  // frame's own, which the greeting under it keeps as well (`ArrivalToast.tsx:uprightContainerStyle`).
  const layer = useChromeLayer({ control: NOTICE_CONTROL });
  const zoom = useNoticeZoom();
  const ratio = useGlidingChromeScale() / zoom;
  const viewportW = useViewportSize().w;
  const upright = useLayoutShape() === 'portrait';
  const lifted: CSSProperties | null = ratio === 1 ? null : {
    width: 'max-content',
    maxWidth: bandMaxWidth(viewportW, zoom, ratio, upright),
  };
  // The band stays mounted until the last toast's exit has played (`onExitComplete`), since
  // unmounting it would tear down <AnimatePresence> mid-exit; empty, it is inert (pointerEvents: none).
  const morph = useMorph('toasts');
  return (
    <div data-testid="toast-band" {...morph} style={{ ...layer, ...containerStyle(ratio, upright, toasts.some((toast) => toast.overWindow)), ...lifted }}>
      <AnimatePresence onExitComplete={() => { if (toasts.length === 0) onEmptied(); }}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            // Exit uses its own non-bouncy ease so the toast slides out cleanly
            // instead of springing (the per-variant transition wins over the
            // component-level bouncy spring used for the entrance).
            exit={{ opacity: 0, y: -10, scale: 0.95, transition: framerMotion('notice.leave') }}
            transition={framerMotion('surface.pop')}
          >
            <ToastFace text={toast.text} type={toast.type} count={toast.count} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
