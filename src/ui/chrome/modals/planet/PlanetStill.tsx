/**
 * A planet at rest in a canvas of the caller's box: the land fitted less `margin` css px, drawn from
 * the renderer's own picture of the map with its plan notes (`usePlanetPicture`), as Change Planet's
 * preview draws it without the pan and zoom.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { paintPlanet, planetPictureSide } from '../../../../view/map2d/capture/planet-painter';
import { useGridRevision } from '../../../session/use-map-derived';
import { useEffectEvent } from '../../../primitives/use-effect-event';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { usePlanetPicture } from './use-planet-picture';

const REST = { tx: 0, ty: 0, scale: 1 } as const;

export function PlanetStill({ template, state, margin, style, testId }: {
  template: MapTemplate;
  /** The map to draw; absent draws the planet as a fresh map opens on it. */
  state?: GridState;
  margin: number;
  style: CSSProperties;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const revision = useGridRevision(state);
  const input = { template, ...(state ? { state } : {}), revision };
  const [side, setSide] = useState(0);
  const picture = usePlanetPicture(input, side, side > 0);

  const paint = () => {
    const canvas = ref.current;
    if (!canvas) return;
    setSide(planetPictureSide(canvas, input, REST, { margin }));
    paintPlanet(canvas, input, picture, REST, { margin });
  };
  const paintNow = useEffectEvent(paint);
  useLayoutEffect(() => { paintNow(); }, [template, state, revision, margin, picture, style.width, style.height]);
  // The canvas takes its backing size from its box, so a resized box repaints.
  const paintRef = useRef(paint);
  paintRef.current = paint;
  useObservedSize(() => ref.current, () => paintRef.current(), []);

  return <canvas ref={ref} aria-hidden data-testid={testId} data-picture={picture ? 'ready' : 'pending'} style={style} />;
}
