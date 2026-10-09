import { randomUUID } from 'node:crypto';

import type { GameId, PlayerId } from '../game/game-id';

/**
 * Chat de partie (D-045). Indépendant du moteur de jeu : il ne lit ni ne modifie l'état d'une
 * partie, il n'en vérifie que l'appartenance (joueurs de `game_players`) et le statut.
 *
 * Le contenu est du TEXTE BRUT : jamais interprété comme HTML ou Markdown, ni par le serveur
 * ni par l'application (affiché dans un composant <Text>).
 */

/** Longueur maximale d'un message, en caractères (points de code). Source de vérité unique : l'API la renvoie au client. */
export const MAX_CHAT_MESSAGE_LENGTH = 500;

/** Taille d'une page d'historique : par défaut et au plus. */
export const DEFAULT_CHAT_PAGE_SIZE = 30;
export const MAX_CHAT_PAGE_SIZE = 50;

export type ChatMessageId = string & { readonly __brand: 'ChatMessageId' };

/** Identifiant de message généré par le serveur (UUID v4), jamais par le client. */
export function newChatMessageId(): ChatMessageId {
  return randomUUID() as ChatMessageId;
}

/** Message tel qu'enregistré et diffusé : exactement le même objet en REST et en temps réel. */
export interface ChatMessage {
  id: ChatMessageId;
  gameId: GameId;
  /** Titulaire du JWT au moment de l'envoi : jamais une valeur fournie par le client. */
  senderId: PlayerId;
  /** Pseudo public (`users.username`), lu en base par le serveur. */
  senderDisplayName: string;
  content: string;
  createdAt: Date;
}

/** Forme JSON d'un message, IDENTIQUE en REST et dans l'événement temps réel `chat:message`. */
export function toChatMessageJson(message: ChatMessage) {
  return {
    id: message.id,
    gameId: message.gameId,
    senderId: message.senderId,
    senderDisplayName: message.senderDisplayName,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

/** Événement temps réel `chat:message`, diffusé dans la salle `game:{gameId}:chat`. */
export interface ChatMessageEvent {
  type: 'chat:message';
  gameId: GameId;
  message: ChatMessage;
}

/** Page d'historique, du plus ancien au plus récent. */
export interface ChatPage {
  messages: ChatMessage[];
  /** D'autres messages existent au-delà de la page (plus anciens, ou plus récents avec `after`). */
  hasMore: boolean;
}

/**
 * Normalise et valide un message : fins de ligne unifiées, espaces de début et de fin
 * retirés, 1 à MAX_CHAT_MESSAGE_LENGTH caractères, aucun caractère de contrôle hormis
 * le saut de ligne et la tabulation (le NUL est d'ailleurs refusé par PostgreSQL).
 * Renvoie le message normalisé, ou la raison du refus.
 */
export function normalizeChatContent(
  value: unknown,
): { ok: true; content: string } | { ok: false; reason: string } {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'Le message doit être un texte.' };
  }
  // Refus avant tout traitement : une entrée démesurée n'est jamais parcourue en entier.
  if (value.length > MAX_CHAT_MESSAGE_LENGTH * 4) {
    return { ok: false, reason: tooLong() };
  }
  const content = value.replace(/\r\n?/g, '\n').trim();
  if (content.length === 0) {
    return { ok: false, reason: 'Le message est vide.' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(content)) {
    return { ok: false, reason: 'Le message contient des caractères non autorisés.' };
  }
  if ([...content].length > MAX_CHAT_MESSAGE_LENGTH) {
    return { ok: false, reason: tooLong() };
  }
  return { ok: true, content };
}

function tooLong(): string {
  return `Le message ne doit pas dépasser ${MAX_CHAT_MESSAGE_LENGTH} caractères.`;
}

/**
 * Partie terminée : l'historique reste lisible par ses joueurs, l'envoi est fermé. Aucune
 * règle n'existait (R-14 ne traite que la modération) : choix le plus restrictif, D-045.
 */
export class ChatClosedError extends Error {
  constructor(readonly gameId: GameId) {
    super(`Chat fermé : partie ${gameId} terminée`);
    this.name = 'ChatClosedError';
  }
}

/** Même clé d'envoi réutilisée pour un AUTRE contenu (un renvoi légitime a le même contenu). */
export class ChatMessageKeyReusedError extends Error {
  constructor() {
    super('Clé de message déjà utilisée pour un autre contenu');
    this.name = 'ChatMessageKeyReusedError';
  }
}

/** Trop de messages en peu de temps (anti-spam, par joueur). */
export class ChatRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Trop de messages');
    this.name = 'ChatRateLimitedError';
  }
}
