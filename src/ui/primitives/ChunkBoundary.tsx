/**
 * The backstop around a lazily loaded surface. A chunk that fails to fetch or parse throws while
 * React renders it, and an uncaught render error unmounts the whole app to a blank page, so every
 * `lazy` site is wrapped in one of these: the failure stays local and shows `fallback`.
 *
 * `resetKey` is the surface's own door. Changing it clears the failure, so closing a window and
 * opening it again asks for the chunk once more.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** What stands in for the surface once its chunk has failed. */
  fallback: ReactNode;
  /** Any value the owning surface changes when it is opened afresh. */
  resetKey?: unknown;
}

export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
