/**
 * Checks the six model-authored copy contracts over a completed session log. The scripted CI actor
 * and the opt-in gateway test share this reader, so both exercise the same measurements.
 *
 * Findings are returned as data because an external model may miss a copy constraint without making
 * the harness itself invalid. Each finding includes enough context to read without the source log.
 *
 * UI bounds:
 *   1 says line      point within about 90 characters; two lines before expansion
 *   2 summary        one to four sentences in a self-sizing receipt
 *   3 stage label    about 30 authored characters; 45 measured; wraps
 *   4 delegate task  `label ?? firstLine(task)`; sliced at 96; two lines
 *   5 suggest_reply  hard-clipped at about 30 Latin or 15 CJK characters
 *   6 quick answers  about 20 per pill; `GateOption.cap` about 40
 *
 * CJK text uses roughly twice the horizontal space of Latin text here. Only contract 5 truncates by
 * script, so the other bounds measure characters directly.
 */
import { eventsOf, type SessionLog } from '../../agent/core/log';
import type { SessionEvent } from '../../agent/core/types';

export interface ContractFinding {
  /** Which of the six, by its number and name. */
  contract: string;
  /** What the model wrote, capped for a report. */
  text: string;
  /** The measurement and the bound, in the terms the contract states. */
  measured: string;
}

/** The bounds, in one place: a test that wants to report against them reads them here. */
export const CONTRACTS = {
  saysPoint: 90,
  summarySentencesMax: 4,
  stageLabel: 45,
  delegateLabel: 96,
  suggestLatin: 30,
  suggestCjk: 15,
  quickAnswer: 20,
  optionCap: 40,
} as const;

const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
/** A sentence end in either script's punctuation: the panel's own reading (`loop.ts:QUESTION_END`
 *  takes both marks for the same reason). */
const SENTENCE_END = /[.!?。！？]/g;

function isCjk(text: string): boolean {
  return CJK.test(text);
}

/** How many characters of ROOM a string spends: a CJK glyph is a full em, so it costs about the two
 *  a Latin character does at the same box. Used only where the box truncates. */
function roomFor(text: string, latin: number, cjk: number): number {
  return isCjk(text) ? cjk : latin;
}

/** Where the first sentence ends, or -1 for a string that never finishes one. */
function firstSentenceEnd(text: string): number {
  SENTENCE_END.lastIndex = 0;
  const m = SENTENCE_END.exec(text);
  return m ? m.index : -1;
}

function countSentences(text: string): number {
  return (text.match(SENTENCE_END) ?? []).length;
}

function say(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

type Assistant = Extract<SessionEvent, { kind: 'assistant' }>;

/**
 * Reads a finished log and reports every model-authored string that does not wear its designed
 * shape. `finalOnly` narrows contract 2 to the closing summary, which is the only text the receipt
 * sizes itself to.
 */
export function checkContracts(log: SessionLog): ContractFinding[] {
  const out: ContractFinding[] = [];
  const events = eventsOf(log);

  for (const ev of events) {
    if (ev.kind === 'assistant') {
      checkSays(ev, out);
      checkCalls(ev, out);
      continue;
    }
    if (ev.kind === 'plan') {
      for (const stage of ev.stages) {
        if (stage.label.length > CONTRACTS.stageLabel) {
          out.push({
            contract: '3 stage label',
            text: say(stage.label),
            measured: `${stage.label.length} chars, one rail row holds ~${CONTRACTS.stageLabel}`,
          });
        }
      }
      continue;
    }
    if (ev.kind === 'gateAsked') {
      for (const answer of ev.quickAnswers ?? []) {
        if (answer.length > CONTRACTS.quickAnswer) {
          out.push({
            contract: '6 quick answer',
            text: say(answer),
            measured: `${answer.length} chars, a pill reads as a choice at ~${CONTRACTS.quickAnswer}`,
          });
        }
      }
      for (const option of ev.options ?? []) {
        if (option.cap.length > CONTRACTS.optionCap) {
          out.push({
            contract: '6 option cap',
            text: say(option.cap),
            measured: `${option.cap.length} chars, the card's line holds ~${CONTRACTS.optionCap}`,
          });
        }
      }
      continue;
    }
    if (ev.kind === 'jobEnd' && ev.summary !== undefined) {
      const sentences = countSentences(ev.summary);
      if (ev.summary.trim() === '' || sentences > CONTRACTS.summarySentencesMax) {
        out.push({
          contract: '2 summary',
          text: say(ev.summary),
          measured: `${sentences} sentences, the receipt is drawn for 1-${CONTRACTS.summarySentencesMax}`,
        });
      }
    }
  }
  return out;
}

function checkSays(ev: Assistant, out: ContractFinding[]): void {
  for (const part of ev.parts) {
    if (part.kind !== 'text') continue;
    const text = part.text.trim();
    if (text === '') continue;
    // THE POINT, not the length: the line is two-line clamped and expands on a tap, so a long say is
    // fine and a say whose first sentence only lands on line three is not.
    const end = firstSentenceEnd(text);
    const point = end === -1 ? text.length : end + 1;
    if (point > CONTRACTS.saysPoint) {
      out.push({
        contract: '1 says line',
        text: say(text),
        measured: `the point lands at ${point} chars, the clamped line shows ~${CONTRACTS.saysPoint}`,
      });
    }
  }
}

function checkCalls(ev: Assistant, out: ContractFinding[]): void {
  for (const part of ev.parts) {
    if (part.kind !== 'tool') continue;
    if (part.name === 'suggest_reply') {
      const reply = typeof part.input.reply === 'string' ? part.input.reply.trim() : '';
      const room = roomFor(reply, CONTRACTS.suggestLatin, CONTRACTS.suggestCjk);
      if (reply.length > room) {
        out.push({
          contract: '5 suggest_reply',
          text: say(reply),
          measured: `${reply.length} chars in a field that CLIPS at ~${room}`
            + `${isCjk(reply) ? ' (CJK, a glyph is a full em)' : ''}`,
        });
      }
      continue;
    }
    if (part.name === 'delegate_task') {
      const label = typeof part.input.label === 'string' ? part.input.label.trim() : '';
      const task = typeof part.input.task === 'string' ? part.input.task : '';
      // The lane names the helper by `label ?? firstLine(task)`, so a task with no label owes its
      // first line the same shape a label has.
      const shown = label !== '' ? label : (task.split('\n')[0] ?? '');
      if (shown.trim() === '') {
        out.push({ contract: '4 delegate label', text: say(task), measured: 'the lane would have no name at all' });
      } else if (shown.length > CONTRACTS.delegateLabel) {
        out.push({
          contract: '4 delegate label',
          text: say(shown),
          measured: `${shown.length} chars, the lane's name is sliced at ${CONTRACTS.delegateLabel}`,
        });
      }
    }
  }
}

/** Format findings for the gateway harness console. */
export function reportContracts(findings: readonly ContractFinding[]): string {
  if (findings.length === 0) return 'every model-authored string wore its designed shape';
  return findings.map((f) => `- [${f.contract}] ${f.measured}\n    "${f.text}"`).join('\n');
}
