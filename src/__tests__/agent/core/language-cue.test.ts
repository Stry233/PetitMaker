import { describe, expect, it } from 'vitest';
import { languageCue } from '../../../agent/core/language-cue';

describe('languageCue', () => {
  it('names the language of a Chinese, Japanese, Russian or Thai message in that language', () => {
    expect(languageCue('帮我在河边建一个小村子')).toContain('中文');
    expect(languageCue('川のそばに小さな村を作って')).toContain('日本語');
    expect(languageCue('построй деревню у реки')).toContain('русск');
    expect(languageCue('สร้างหมู่บ้านริมแม่น้ำ')).toContain('ภาษาไทย');
  });

  it('treats kana as Japanese even beside Han characters, and Han with Latin words as Chinese', () => {
    expect(languageCue('村を作って 川 pond')).toContain('日本語');
    expect(languageCue('建一个 pond 在河边')).toContain('中文');
  });

  it('asks for the language of the message itself for Latin-script text', () => {
    expect(languageCue('build a village by the river')).toBe('(language) Think and reply in the language of this message.');
    expect(languageCue('construis un village près de la rivière')).toContain('language of this message');
  });

  it('adds nothing to a message with no readable words', () => {
    expect(languageCue('(12, 7)')).toBe('');
    expect(languageCue('')).toBe('');
  });

  it('starts every cue with the note tag the loop uses', () => {
    for (const text of ['你好', 'こんにちは', 'привет', 'สวัสดี', 'hello']) expect(languageCue(text)).toMatch(/^\(language\) /);
  });
});
