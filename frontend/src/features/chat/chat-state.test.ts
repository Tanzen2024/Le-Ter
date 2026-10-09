/// <reference types="jest" />
import type { ChatMessage } from '../../types/chat';
import { mergeMessages, messageForGame, unreadCount } from './chat-state';
import { mergeLatest } from './hooks';

const GAME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function msg(id: string, at: string, senderId = 'p1', gameId = GAME): ChatMessage {
  return {
    id,
    gameId,
    senderId,
    senderDisplayName: senderId,
    content: `texte ${id}`,
    createdAt: `2026-10-08T10:00:${at}.000Z`,
  };
}

describe('mergeMessages', () => {
  it('fusionne sans doublon et dans l’ordre du serveur', () => {
    const merged = mergeMessages([msg('b', '02'), msg('a', '01')], [msg('c', '03'), msg('b', '02')]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('même horodatage : départage par identifiant', () => {
    expect(mergeMessages([], [msg('z', '01'), msg('y', '01')]).map((m) => m.id)).toEqual(['y', 'z']);
  });

  it('renvoie la même liste si rien de neuf (aucun rendu inutile)', () => {
    const list = [msg('a', '01')];
    expect(mergeMessages(list, [msg('a', '01')])).toBe(list);
  });
});

describe('messageForGame', () => {
  const event = (gameId: string, message: ChatMessage) => ({ type: 'chat:message', gameId, message });

  it('accepte un message de la partie affichée', () => {
    expect(messageForGame(event(GAME, msg('a', '01')), GAME)?.id).toBe('a');
  });

  it('ignore un événement d’une autre partie (en-tête ou message)', () => {
    expect(messageForGame(event(OTHER, msg('a', '01', 'p1', OTHER)), GAME)).toBeUndefined();
    expect(messageForGame(event(GAME, msg('a', '01', 'p1', OTHER)), GAME)).toBeUndefined();
  });

  it('ignore les trames mal formées', () => {
    expect(messageForGame(null, GAME)).toBeUndefined();
    expect(messageForGame({ type: 'autre', gameId: GAME }, GAME)).toBeUndefined();
    expect(
      messageForGame({ type: 'chat:message', gameId: GAME, message: { gameId: GAME } }, GAME),
    ).toBeUndefined();
  });
});

describe('unreadCount', () => {
  it('compte les messages des autres après le dernier vu', () => {
    const list = [msg('a', '01', 'moi'), msg('b', '02', 'lui'), msg('c', '03', 'moi'), msg('d', '04', 'lui')];
    expect(unreadCount(list, 'a', 'moi')).toBe(2);
    expect(unreadCount(list, 'd', 'moi')).toBe(0);
    expect(unreadCount(list, undefined, 'moi')).toBe(2);
  });
});

describe('mergeLatest (relecture de la dernière page)', () => {
  const history = (messages: ChatMessage[], hasMore: boolean) => ({
    messages,
    hasMore,
    canSend: true,
    maxMessageLength: 500,
  });

  it('garde les pages plus anciennes déjà chargées', () => {
    const previous = history([msg('a', '01'), msg('b', '02')], false);
    const latest = history([msg('b', '02'), msg('c', '03')], true);
    const merged = mergeLatest(previous, latest);
    expect(merged.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(merged.hasMore).toBe(false);
  });

  it('trou possible (aucun recouvrement) : repart de la dernière page', () => {
    const previous = history([msg('a', '01')], false);
    const latest = history([msg('x', '30'), msg('y', '31')], true);
    expect(mergeLatest(previous, latest)).toBe(latest);
  });
});
