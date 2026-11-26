/** Reaches the worker that builds a scene's worlds, spawned by the first figure that needs one. */
import { createWorkerClient, WORKER_IDLE_MS, type WorkerClient } from '../../platform/async/worker-client';
import type { SceneWorldReply, SceneWorldRequest } from './scene-world.worker';

let builder: WorkerClient<SceneWorldRequest, SceneWorldReply> | null = null;

/** The neighbourhood and the plot asked for from the worker; null where no worker answers, which
 *  leaves them to `scene-worlds.ts:sceneBase` on the main thread. */
export function buildInWorker(request: SceneWorldRequest): Promise<SceneWorldReply | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  builder ??= createWorkerClient<SceneWorldRequest, SceneWorldReply>({
    spawn: () => new Worker(new URL('./scene-world.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: WORKER_IDLE_MS, keyed: true,
  });
  return builder.request<SceneWorldReply | null>({
    message: request, timeoutMs: 60_000, read: (reply) => reply, fallback: () => null,
  });
}
