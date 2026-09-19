import { motion, useIsPresent } from 'framer-motion';
import { useMotion } from '../motion/use-motion';
import { BrushSizeSlider, SLIDER_LIFT } from './BrushSizeSlider';

/** An exiting slider keeps its place but stops accepting input. */
export function BrushSizeControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const present = useIsPresent();
  const transition = useMotion('slider.visibility');
  return <motion.div data-brush-size-control aria-hidden={!present || undefined}
    {...(!present ? { inert: '' } : {})}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}
    style={{ flex: 'none', marginLeft: 'auto', marginTop: SLIDER_LIFT }}>
    <BrushSizeSlider value={value} onChange={next => { if (present) onChange(next); }}/>
  </motion.div>;
}
