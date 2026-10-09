import { MAX_CHAT_MESSAGE_LENGTH, normalizeChatContent } from '../../../src/domain/chat/chat';
import { parseChatPageQuery } from '../../../src/validators/chat.validators';
import { ValidationError } from '../../../src/validators/validation-error';

describe('normalizeChatContent (D-045)', () => {
  it('retire les espaces de bord et unifie les fins de ligne', () => {
    expect(normalizeChatContent('  a\r\nb\rc  ')).toEqual({ ok: true, content: 'a\nb\nc' });
  });

  it('compte en caractères réels : un emoji vaut un caractère', () => {
    expect(normalizeChatContent('😀'.repeat(MAX_CHAT_MESSAGE_LENGTH)).ok).toBe(true);
    expect(normalizeChatContent('😀'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1)).ok).toBe(false);
  });

  it('refuse le vide, le non-texte et les caractères de contrôle', () => {
    for (const value of ['', ' \n ', null, 3, ['a'], 'a\u0007b', 'a\u0000']) {
      expect(normalizeChatContent(value).ok).toBe(false);
    }
  });

  it('garde HTML et Markdown tels quels (texte brut, jamais interprété)', () => {
    expect(normalizeChatContent('<i>x</i> **y**')).toEqual({ ok: true, content: '<i>x</i> **y**' });
  });
});

describe('parseChatPageQuery', () => {
  it('limite par défaut, bornes, curseurs exclusifs', () => {
    expect(parseChatPageQuery({})).toEqual({ limit: 30 });
    expect(parseChatPageQuery({ limit: '50' })).toEqual({ limit: 50 });
    expect(() => parseChatPageQuery({ limit: '2.5' })).toThrow(ValidationError);
    expect(() => parseChatPageQuery({ before: ['x'] })).toThrow(ValidationError);
  });
});
