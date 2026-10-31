/**
 * The one way a re-arrangement is measured and played: measured in the commit that changes `change`,
 * before its DOM changes, and played on the next animation frame, once the layout effects and the
 * renders they set off have committed and before that frame paints. A second change committed before
 * that frame keeps the first measure, which is what the screen last showed. A commit made inside a
 * frame callback would paint one frame of the new arrangement before the play; no caller commits there.
 */
import { Component, type ReactNode } from 'react';

interface MorphOnChangeProps<F> {
  /** What re-arranges: a commit that changes it (by `Object.is`) is measured. */
  change: unknown;
  /** Where the pieces stand before the DOM changes; null morphs nothing. */
  measure: () => F | null;
  /** In the commit that re-arranged, with what `measure` returned, before the play's frame. */
  committed?: (first: F) => void;
  /** Draws the pieces from `first` to where they stand now. */
  play: (first: F) => void;
  /** Ends whatever is still playing, as the host unmounts. */
  stop?: () => void;
  children: ReactNode;
}

/** A class, for `getSnapshotBeforeUpdate`: the one point in a commit before any of its DOM changes. */
export class MorphOnChange<F> extends Component<MorphOnChangeProps<F>> {
  /** The animation frame a play waits for, and the measure it plays. */
  private frame = 0;
  private pending: F | null = null;

  getSnapshotBeforeUpdate(prev: Readonly<MorphOnChangeProps<F>>): F | null {
    if (Object.is(prev.change, this.props.change)) return null;
    return this.frame && this.pending !== null ? this.pending : this.props.measure();
  }

  // Present for the snapshot above: React passes it only to `componentDidUpdate`.
  componentDidUpdate(_prev: Readonly<MorphOnChangeProps<F>>, _state: unknown, first: F | null): void {
    if (first === null) return;
    this.props.committed?.(first);
    this.replay(first);
  }

  componentWillUnmount(): void {
    this.cancel();
    this.props.stop?.();
  }

  /** Plays `first` on the next animation frame, replacing a play still waiting for one. */
  replay(first: F): void {
    if (typeof requestAnimationFrame !== 'function') { this.props.play(first); return; }
    this.cancel();
    this.pending = first;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.pending = null;
      this.props.play(first);
    });
  }

  private cancel(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = null;
  }

  render(): ReactNode {
    return this.props.children;
  }
}
