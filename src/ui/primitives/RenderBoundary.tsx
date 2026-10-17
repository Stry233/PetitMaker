/**
 * Keeps a render failure local. An uncaught error while React renders or commits a subtree unmounts
 * the whole app to a blank page, so a surface that can fail on its own (a lazy chunk that never
 * arrives, a panel that throws) stands inside one of these and shows `fallback` instead.
 *
 * The subtree comes back when `resetKey` changes (the owner's door: a window opened afresh, another
 * mode chosen) or when the fallback calls `retry`; either way it mounts from scratch.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** What stands in for the subtree once it has failed, given the way to mount it again. */
  fallback: ReactNode | ((retry: () => void) => ReactNode);
  /** Any value the owning surface changes when it is opened afresh. */
  resetKey?: unknown;
  /** Hears each failure once, as the fallback replaces the subtree. */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

export class RenderBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.retry();
  }

  private retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === 'function' ? fallback(this.retry) : fallback;
  }
}
