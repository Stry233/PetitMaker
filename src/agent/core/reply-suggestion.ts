import type { Adapter, AdapterRequest } from '../providers/types';
import type { Usage } from './types';
import { withIdleTimeout } from './stream-idle';
import REPLY_SYSTEM from '../prompts/11-reply-suggestion.md?raw';

/** Optional composer assistance has a total deadline, including streamed reasoning. */
const REPLY_DEADLINE_MS = 8000;
const REPLY_MAX_TOKENS = 256;

/** The composer displays one line; provider prose remains unchanged in its original turn. */
export function sanitizeSuggestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return raw.trim().split('\n')[0]?.slice(0, 96) || null;
}

/** A separate, tool-free draft cannot continue the build or enter provider conversation history. */
export async function requestReplySuggestion(
  adapter: Adapter,
  connection: Pick<AdapterRequest, 'model' | 'capabilities' | 'thinking'>,
  context: { request: string; question: string },
  signal: AbortSignal,
): Promise<{ reply: string; usage?: Usage } | null> {
  if (signal.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REPLY_DEADLINE_MS);
  try {
    const stream = adapter.stream({
      ...connection,
      system: REPLY_SYSTEM,
      messages: [{ role: 'user', text: JSON.stringify({ request: context.request.slice(0, 2000), question: context.question.slice(-4000) }) }],
      tools: [], sameModel: false, maxOutputTokens: REPLY_MAX_TOKENS,
    }, controller.signal);
    let text = '';
    for await (const event of withIdleTimeout(stream, { signal: controller.signal })) {
      if (event.t === 'text') text += event.delta;
      if (text.length > 1024 || event.t === 'error' || event.t === 'tool-start') return null;
      if (event.t === 'done') {
        if (event.stop !== 'stop' || event.final?.length || controller.signal.aborted) return null;
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || !('reply' in parsed)) return null;
        if (typeof parsed.reply !== 'string' || parsed.reply.trim().length > 96 || /[\r\n]/.test(parsed.reply.trim())) return null;
        const reply = sanitizeSuggestion(parsed.reply);
        return reply ? { reply, ...(event.usage ? { usage: event.usage } : {}) } : null;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
