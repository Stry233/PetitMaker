/*
 * SplatHeader.tsx — the yellow-splat + centered category icon header shared by
 * the Placement panel and the Build panel's tile mode. The splat sits at a fixed
 * PSD box; the icon is centered on its PSD ink-bbox center (cx, cy) at (iw, ih).
 * (The title span is drawn by each panel separately — only the badge is shared.)
 */
import { iconUrl } from './icons';

interface Props {
  px: (n: number) => number;
  icon: string;
  cx: number;
  cy: number;
  iw: number;
  ih: number;
}

export function SplatHeader({ px, icon, cx, cy, iw, ih }: Props) {
  return (
    <>
      <img src={iconUrl('splat')} alt="" draggable={false} style={{ position: 'absolute', left: px(76), top: px(47), width: px(161), height: px(85), objectFit: 'contain', pointerEvents: 'none' }} />
      <img src={iconUrl(icon)} alt="" draggable={false} style={{ position: 'absolute', left: px(cx), top: px(cy), width: px(iw), height: px(ih), transform: 'translate(-50%, -50%)', objectFit: 'contain', pointerEvents: 'none' }} />
    </>
  );
}
