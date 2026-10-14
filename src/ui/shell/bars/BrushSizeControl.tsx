import { useIsPresent } from 'framer-motion';
import { BrushSizeSlider, SLIDER_LIFT } from './BrushSizeSlider';

/** An exiting slider keeps its place but stops accepting input; its toolbar slot fades it. */
export function BrushSizeControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const present = useIsPresent();
  return <div data-brush-size-control style={{ marginTop: SLIDER_LIFT }}>
    <BrushSizeSlider value={value} onChange={next => { if (present) onChange(next); }}/>
  </div>;
}
