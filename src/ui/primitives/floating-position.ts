import type { CSSProperties } from 'react';

interface FloatingAnchor { left: number; top: number; right: number; bottom: number; width: number }
export interface FloatingPlacement {
  box: CSSProperties;
  /** The card opens above its anchor; false too when it stands over the anchor (`overlap`). */
  above: boolean;
  /** Where the anchor's aligned point falls along the card's width, in the card's px. */
  anchorX: number;
  /** The height the window leaves the card on the side it opens on, in the card's px. */
  room: number;
  /** The anchor's width, in the card's px. */
  anchorWidth: number;
}

/** The least air a floating card keeps from the window's edges, in visual px. */
export const FLOATING_MARGIN = 8;

/** Anchors and viewport dimensions are visual pixels; returned lengths belong to the zoomed card. */
export function placeFloating({ anchor, width, height, zoom, viewport, gap = 0, align = 'start', maxHeight = Infinity, margin = FLOATING_MARGIN, prefer = 'below', side, overlap = false }: {
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
  /** Open on this side whatever the room, capping the card to it, so content that grows lengthens
   *  the card away from the anchor and never moves the edge facing it. */
  side?: 'above' | 'below';
  /** Where neither side holds the whole card, centre it over the anchor instead of capping it to
   *  one side; a card taller than the window is then capped to the window. */
  overlap?: boolean;
}): FloatingPlacement {
  const availableWidth = Math.max(0, viewport.width - 2 * margin);
  const drawnWidth = Math.min(width * zoom, availableWidth);
  const below = Math.max(0, viewport.height - anchor.bottom - gap * zoom - margin);
  const aboveRoom = Math.max(0, anchor.top - gap * zoom - margin);
  const desiredHeight = Math.min(height, maxHeight) * zoom;
  const above = side ? side === 'above'
    : prefer === 'above' ? desiredHeight <= aboveRoom || aboveRoom > below : desiredHeight > below && aboveRoom > below;
  const windowRoom = Math.max(0, viewport.height - 2 * margin);
  const overlaps = overlap && !side && desiredHeight > Math.max(aboveRoom, below);
  const room = overlaps ? windowRoom : Math.min(windowRoom, above ? aboveRoom : below);
  const cap = Math.min(maxHeight * zoom, room);
  const drawnHeight = Math.min(desiredHeight, cap);
  const wantedLeft = align === 'center' ? (anchor.left + anchor.right - drawnWidth) / 2 : align === 'end' ? anchor.right - drawnWidth : anchor.left;
  const left = Math.max(margin, Math.min(wantedLeft, viewport.width - drawnWidth - margin));
  const wantedTop = overlaps ? (anchor.top + anchor.bottom - drawnHeight) / 2
    : above ? anchor.top - gap * zoom - drawnHeight : anchor.bottom + gap * zoom;
  const top = Math.max(margin, Math.min(wantedTop, viewport.height - drawnHeight - margin));
  const anchorPoint = align === 'center' ? (anchor.left + anchor.right) / 2 : align === 'end' ? anchor.right : anchor.left;
  return {
    above: above && !overlaps,
    anchorX: Math.max(0, Math.min(drawnWidth, anchorPoint - left)) / zoom,
    room: room / zoom,
    anchorWidth: anchor.width / zoom,
    box: {
      position: 'fixed', boxSizing: 'border-box', left: left / zoom, top: top / zoom,
      width: drawnWidth / zoom, maxWidth: availableWidth / zoom, maxHeight: cap / zoom,
      overflowY: 'auto',
    },
  };
}
