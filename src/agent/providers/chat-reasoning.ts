/** Thinking and signed tool metadata travel separately from assistant prose. */
type Fields = Record<string, unknown>;
interface RawChat { dialect: 'chat'; endpoint?: string; fields: Fields; calls: { callId: string; extra: unknown }[] }

export class ChatReasoning {
  private fields: Fields = {};
  private calls = new Map<string, unknown>();
  constructor(private names: readonly string[], private endpoint?: string) {}

  add(delta: Fields): string[] {
    const text: string[] = [];
    for (const name of this.names) {
      const value = delta[name];
      if (typeof value !== 'string' || !value) continue;
      this.fields[name] = String(this.fields[name] ?? '') + value;
      if (!text.length) text.push(value);
    }
    if (Array.isArray(delta.reasoning_details)) {
      this.fields.reasoning_details = [...(this.fields.reasoning_details as unknown[] ?? []), ...delta.reasoning_details];
      if (!text.length) for (const item of delta.reasoning_details) {
        if (item?.type === 'reasoning.text' && typeof item.text === 'string') text.push(item.text);
        if (item?.type === 'reasoning.summary' && typeof item.summary === 'string') text.push(item.summary);
      }
    }
    return text;
  }

  tool(callId: string, extra: unknown): void {
    if (extra && typeof extra === 'object') this.calls.set(callId, extra);
  }

  raw(): RawChat | undefined {
    if (!Object.keys(this.fields).length && !this.calls.size) return undefined;
    return { dialect: 'chat', ...(this.endpoint === undefined ? {} : { endpoint: this.endpoint }), fields: this.fields, calls: [...this.calls].map(([callId, extra]) => ({ callId, extra })) };
  }
}

/** Only recognized provider fields are replayed, and callers additionally require the same model. */
export function savedChat(raw: unknown): RawChat | undefined {
  if (!raw || typeof raw !== 'object' || !('dialect' in raw) || raw.dialect !== 'chat') return undefined;
  const value = raw as RawChat;
  if (!value.fields || typeof value.fields !== 'object' || !Array.isArray(value.calls)) return undefined;
  const fields: Fields = {};
  for (const name of ['reasoning', 'reasoning_content']) if (typeof value.fields[name] === 'string') fields[name] = value.fields[name];
  if (Array.isArray(value.fields.reasoning_details)) fields.reasoning_details = value.fields.reasoning_details;
  return { dialect: 'chat', ...(typeof value.endpoint === 'string' ? { endpoint: value.endpoint } : {}), fields, calls: value.calls.filter((c) => c && typeof c.callId === 'string' && c.extra && typeof c.extra === 'object') };
}
