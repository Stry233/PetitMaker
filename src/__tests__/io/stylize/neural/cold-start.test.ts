// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createServer } from 'vite';
// @ts-ignore - node builtins are untyped in this tree
import { mkdtempSync, rmSync } from 'node:fs';
// @ts-ignore - node builtins are untyped in this tree
import { tmpdir } from 'node:os';
// @ts-ignore - node builtins are untyped in this tree
import { join, resolve } from 'node:path';

declare const __dirname: string;

it('serves the first inference worker without changing the dependency graph or reloading the page', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'petit-neural-cold-'));
  const root = resolve(__dirname, '../../../../..');
  const server = await createServer({
    root, cacheDir: cache, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, watch: null },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    await fetch(origin);
    const optimizer = server.environments.client!.depsOptimizer!;
    await optimizer.scanProcessing;
    await vi.waitFor(() => {
      for (const runtime of ['onnxruntime-web/webgpu', 'onnxruntime-web']) {
        expect(optimizer.metadata.optimized[runtime], `${runtime} is ready before Generate`).toBeDefined();
      }
    }, { timeout: 15000 });
    const hash = optimizer.metadata.browserHash;
    const send = vi.spyOn(server.ws, 'send');
    const response = await fetch(`${origin}/src/io/stylize/neural/neural.worker.ts?worker_file&type=module`);
    expect(response.ok).toBe(true);
    const worker = await response.text();
    const imports = [...worker.matchAll(/import\("([^"]+)"\)/g)].map(match => match[1]!);
    expect(imports).toHaveLength(2);
    for (const path of imports) expect((await fetch(new URL(path, origin))).ok).toBe(true);
    await server.environments.client!.waitForRequestsIdle();
    expect(Object.keys(optimizer.metadata.discovered)).toEqual([]);
    expect(optimizer.metadata.browserHash).toBe(hash);
    expect(send.mock.calls.map(args => args[0])).not.toContainEqual(expect.objectContaining({ type: 'full-reload' }));
  } finally {
    await server.close();
    rmSync(cache, { recursive: true, force: true });
  }
}, 30000);
