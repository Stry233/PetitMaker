/** Per-message language cue: names the language of the user's words right where the model reads them last. */

/** Cues written in the language they name; the cue's own script sets the language of what follows it. */
const CUES = {
  ja: 'このメッセージと同じ日本語で考え、返答してください。',
  zh: '用中文思考并回复，与这条消息一致。',
  ru: 'Думайте и отвечайте по-русски, на языке этого сообщения.',
  th: 'คิดและตอบเป็นภาษาไทย ตามภาษาของข้อความนี้',
  latin: 'Think and reply in the language of this message.',
} as const;

/** Kana settles Japanese before Han, since Japanese text carries both; Han beside Latin words reads as Chinese. */
function scriptOf(text: string): keyof typeof CUES | null {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/\p{Script=Han}/u.test(text)) return 'zh';
  if (/\p{Script=Cyrillic}/u.test(text)) return 'ru';
  if (/\p{Script=Thai}/u.test(text)) return 'th';
  if (/\p{Script=Latin}/u.test(text)) return 'latin';
  return null;
}

/** The loop-note line appended to a user message, or '' when the message has no readable words. */
export function languageCue(text: string): string {
  const script = scriptOf(text);
  return script === null ? '' : `(language) ${CUES[script]}`;
}
