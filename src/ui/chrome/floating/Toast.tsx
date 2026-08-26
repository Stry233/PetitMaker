import { useEffect, useState, useCallback, useRef } from 'react';
import { useChromeScale, useWeightVars } from '../../design/scale';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, font, inkTint, radii, springs, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useEditorStore } from '../../../state/store';
import { useT } from '../../../i18n/context';
import type { ValidationError } from '../../../core/model/types';
import { setToastPresenter, type ToastType } from '../../../core/runtime/toast-bus';
import { TOAST_BAND_TOP } from './toast-band';

export { showToast } from '../../../core/runtime/toast-bus';

const TOAST_DURATION = 3000;

const containerStyle: CSSProperties = {
  position: 'fixed',
  top: TOAST_BAND_TOP,
  // Centred over the WORK: while the assistant's panel is docked it owns a strip at one side of the
  // window, and a notice about what just happened on the map belongs over the map. Half the difference
  // between the two edges, since the dock stands at either and only one is ever non-zero.
  left: 'calc(50% + (var(--pin-dock-left, 0px) - var(--pin-dock-right, 0px)) / 2)',
  transform: 'translateX(-50%)',
  zIndex: z.toast,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  pointerEvents: 'none',
};


interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
  count: number;
}

function accentColor(type: ToastType): string {
  return type === 'error' ? colors.statusError
    : type === 'warning' ? colors.accentPrimary
    : colors.statusSuccess;
}

const toastStyle: CSSProperties = {
  background: colors.panelCream,
  color: colors.frameDark,
  ...roleFont('menu'),
  // A toast wraps at `maxWidth`, so the leading is part of the token rather than the browser's.
  lineHeight: '150%',
  fontFamily: font.family,
  padding: '11px 18px',
  borderRadius: 18,
  boxShadow: `0 10px 28px ${inkTint(0.22)}, 0 2px 6px ${colors.inkBorder}`,
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
  color: colors.white,
  ...roleFont('caption'),
  fontFamily: font.family,
  borderRadius: radii.pill,
  padding: '1px 7px',
  minWidth: 20,
  textAlign: 'center',
  lineHeight: '18px',
});

let nextId = 0;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const eventBus = useEditorStore((s) => s.eventBus);
  const t = useT();

  const addToast = useCallback((text: string, type: ToastType = 'error') => {
    setToasts((prev) => {
      const existing = prev.find((t) => t.text === text && t.type === type);
      if (existing) {
        const oldTimer = timersRef.current.get(existing.id);
        if (oldTimer) clearTimeout(oldTimer);
        const timer = setTimeout(() => {
          setToasts((p) => p.filter((t) => t.id !== existing.id));
          timersRef.current.delete(existing.id);
        }, TOAST_DURATION);
        timersRef.current.set(existing.id, timer);

        return prev.map((t) =>
          t.id === existing.id ? { ...t, count: t.count + 1 } : t
        );
      }

      const id = nextId++;
      const timer = setTimeout(() => {
        setToasts((p) => p.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, TOAST_DURATION);
      timersRef.current.set(id, timer);

      return [...prev.slice(-2), { id, text, type, count: 1 }];
    });
  }, []);

  useEffect(() => setToastPresenter(addToast), [addToast]);

  useEffect(() => {
    const handler = ({ errors }: { errors: ValidationError[] }) => {
      if (errors.length === 0) return;
      const first = errors[0]!;
      const message = t(first.message, first.messageParams);
      addToast(message, 'error');
    };
    eventBus.on('validation-failed', handler);
    return () => eventBus.off('validation-failed', handler);
  }, [eventBus, t, addToast]);

  const chrome = useChromeScale();
  const weights = useWeightVars();
  // Never early-return null while toasts could be exiting: unmounting the
  // container tears down <AnimatePresence> before it can play the last toast's
  // exit. The empty container is inert (pointerEvents: none), so keep it mounted
  // and let AnimatePresence animate the final toast out.
  return (
    <div style={{ ...containerStyle, zoom: chrome, ...weights }}>
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            data-testid="toast"
            style={toastStyle}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            // Exit uses its own non-bouncy ease so the toast slides out cleanly
            // instead of springing (the per-variant transition wins over the
            // component-level bouncy spring used for the entrance).
            exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={springs.bouncy}
          >
            <span style={dotStyle(toast.type)} />
            {toast.text}
            {toast.count > 1 && (
              <motion.span
                key={toast.count}
                style={badgeStyle(toast.type)}
                initial={{ scale: 1.4 }}
                animate={{ scale: 1 }}
                transition={springs.stiff}
              >
                {toast.count}
              </motion.span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
