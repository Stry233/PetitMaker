/*
 * icons.tsx — UI helpers for the icon PNGs (the only sanctioned raster
 * assets; everything else in the UI is built natively). URL resolution lives
 * in src/assets/icon-urls.ts so the PixiJS renderer can share the same map.
 */
import type { CSSProperties } from 'react';
import { iconUrl } from '../../assets/icon-urls';

export { iconUrl };

export interface IconProps {
  /** Basename without extension, e.g. "mountain". */
  name: string;
  size: number;
  style?: CSSProperties;
}

/**
 * A contained, centered icon. The PNGs carry their own hand-drawn outlines,
 * so we only need to scale and center them inside the slot.
 */
export function Icon({ name, size, style }: IconProps) {
  const url = iconUrl(name);
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'block',
        pointerEvents: 'none',
        userSelect: 'none',
        ...style,
      }}
    />
  );
}
