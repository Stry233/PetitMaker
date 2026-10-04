import type { CSSProperties } from 'react';

interface FloatingAnchor { left: number; top: number; right: number; bottom: number; width: number }
export interface FloatingPlacement {
  box: CSSProperties;
  above: boolean;
  /** Where the anchor's aligned point falls along the card's width, in the card's px. */
  anchorX: number;
  /** The height the window leaves the card on the side it opens on, in the card's px. */
  room: number;
}

/** Anchors and viewport dimensions are visual pixels; returned lengths belong to the zoomed card. */
export function placeFloating({ anchor, width, height, zoom, viewport, gap = 0, align = 'start', maxHeight = Infinity, margin = 8, prefer = 'below' }: {
  anchor: FloatingAnchor;
  width: number;
  height: number;
  zoom: number;
  viewport: { width: number; height: number };
  gap?: number;
  align?: 'start' | 'center' | 'end';
  maxHeight?: number;
  margin?: number;
  /** The side to open on while it has room for the whole card. */
  prefer?: 'above' | 'below';
}): FloatingPlacement {
  const availableWidth = Math.max(0, viewport.width - 2 * margin);
  const drawnWidth = Math.min(width * zoom, availableWidth);
  const below = Math.max(0, viewport.height - anchor.bottom - gap * zoom - margin);
  const aboveRoom = Math.max(0, anchor.top - gap * zoom - margin);
  const desiredHeight = Math.min(height, maxHeight) * zoom;
  const above = prefer === 'above' ? desiredHeight <= aboveRoom || aboveRoom > below : desiredHeight > below && aboveRoom > below;
  const room = Math.min(Math.max(0, viewport.height - 2 * margin), above ? aboveRoom : below);
  const cap = Math.min(maxHeight * zoom, room);
  const drawnHeight = Math.min(desiredHeight, cap);
  const wantedLeft = align === 'center' ? (anchor.left + anchor.right - drawnWidth) / 2 : align === 'end' ? anchor.right - drawnWidth : anchor.left;
  const left = Math.max(margin, Math.min(wantedLeft, viewport.width - drawnWidth - margin));
  const wantedTop = above ? anchor.top - gap * zoom - drawnHeight : anchor.bottom + gap * zoom;
  const top = Math.max(margin, Math.min(wantedTop, viewport.height - drawnHeight - margin));
  const anchorPoint = align === 'center' ? (anchor.left + anchor.right) / 2 : align === 'end' ? anchor.right : anchor.left;
  return {
    above,
    anchorX: Math.max(0, Math.min(drawnWidth, anchorPoint - left)) / zoom,
    room: room / zoom,
    box: {
      position: 'fixed', boxSizing: 'border-box', left: left / zoom, top: top / zoom,
      width: drawnWidth / zoom, maxWidth: availableWidth / zoom, maxHeight: cap / zoom,
      overflowY: 'auto',
    },
  };
}
