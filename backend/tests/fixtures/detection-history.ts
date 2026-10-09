import type { CardId } from '../../src/domain/cards/card';
import { cardFromId } from '../../src/domain/cards/card';
import type { CompletedTrick, Game, GameEndReason } from '../../src/domain/game/game';
import type { GameId, PlayerId } from '../../src/domain/game/game-id';
import type { SessionId } from '../../src/domain/sessions/session';

/**
 * Parties TERMINÉES construites à partir d'un script de tours, pour les tests de la
 * détection comportementale (R-36, étape 3). Le contrôleur de chaque tour suit la règle
 * officielle (la plus haute carte de la famille du meneur) ; le gagnant est le contrôleur
 * du 5e tour. Aucune donnée inventée dans l'application : réservé aux tests.
 */
export type TrickScript = [PlayerId, CardId][];

let counter = 0;
export function nextTestGameId(): GameId {
  counter += 1;
  return `00000000-0000-4000-9000-${counter.toString(16).padStart(12, '0')}` as GameId;
}

function controllerOf(plays: TrickScript): PlayerId {
  const lead = cardFromId(plays[0]![1]);
  let best = { playerId: plays[0]![0], value: lead.value };
  for (const [playerId, cardId] of plays.slice(1)) {
    const card = cardFromId(cardId);
    if (card.suit === lead.suit && card.value > best.value) best = { playerId, value: card.value };
  }
  return best.playerId;
}

export function finishedGame(options: {
  players: PlayerId[];
  tricks?: TrickScript[];
  sessionId?: SessionId;
  finishedAt?: Date;
  endReason?: GameEndReason;
  winnerId?: PlayerId;
  fled?: PlayerId[];
  recentCommandIds?: (gameId: GameId) => string[];
}): Game {
  const id = nextTestGameId();
  const at = options.finishedAt ?? new Date();
  const tricks: CompletedTrick[] = (options.tricks ?? []).map((plays, i) => ({
    number: i + 1,
    plays: plays.map(([playerId, cardId]) => ({ playerId, cardId })),
    controllerId: controllerOf(plays),
  }));
  const endReason = options.endReason ?? 'CONTROL_AFTER_LAST_TRICK';
  const lastController = tricks.at(-1)?.controllerId;
  const winnerId =
    endReason === 'INSTANT_WIN_TIE' || endReason === 'ADMIN_STOP'
      ? undefined
      : (options.winnerId ?? lastController ?? options.players[0]!);
  const fled = options.fled ?? [];
  return {
    id,
    ...(options.sessionId && { sessionId: options.sessionId }),
    firstPlayerId: options.players[0]!,
    version: 10,
    status: 'finished',
    creatorId: options.players[0]!,
    maxPlayers: Math.max(2, options.players.length),
    players: options.players.map((playerId, seat) => ({
      playerId,
      seat,
      tablePosition: seat,
      joinedAt: new Date(at.getTime() - 10 * 60_000),
      ...(fled.includes(playerId) && { fledAt: new Date(at.getTime() - 9 * 60_000) }),
    })),
    play: {
      dealOrder: [...options.players],
      hands: Object.fromEntries(options.players.map((p) => [p, []])),
      stock: [],
      trickNumber: 5,
      trickOrder: [],
      currentTrick: [],
      completedTricks: tricks,
      control: { playerId: lastController ?? options.players[0]! },
    },
    ...(winnerId && {
      result: {
        winnerId,
        method: endReason === 'INSTANT_WIN' ? 'INSTANT_WIN' : 'CONTROL_AFTER_LAST_TRICK',
        remainingOpponentIds: options.players.filter((p) => p !== winnerId && !fled.includes(p)),
        fledPlayerIds: fled,
      },
    }),
    endReason,
    createdAt: new Date(at.getTime() - 11 * 60_000),
    updatedAt: at,
    startedAt: new Date(at.getTime() - 10 * 60_000),
    finishedAt: at,
    recentCommandIds: options.recentCommandIds?.(id) ?? [],
  } as Game;
}

/**
 * X renonce DEUX fois à prendre le contrôle à Y (tours 1 et 2), alors qu'il pouvait.
 * Tour 3 : toutes ses cartes légales prennent (aucun choix). Tour 4 : Y n'a plus de cœur
 * (aucun choix). Tour 5 : automatique.
 */
export const declinesAgainst = (x: PlayerId, y: PlayerId): TrickScript[] => [
  [
    [y, 'COEUR-5'],
    [x, 'COEUR-3'],
  ],
  [
    [y, 'COEUR-6'],
    [x, 'COEUR-4'],
  ],
  [
    [y, 'COEUR-7'],
    [x, 'COEUR-9'],
  ],
  [
    [x, 'COEUR-10'],
    [y, 'PIQUE-3'],
  ],
  [
    [x, 'PIQUE-4'],
    [y, 'ETOILE-3'],
  ],
];

/** X prend DEUX fois le contrôle à Z quand il le peut (tours 1 et 3). */
export const takesAgainst = (x: PlayerId, z: PlayerId): TrickScript[] => [
  [
    [z, 'COEUR-5'],
    [x, 'COEUR-9'],
  ],
  [
    [x, 'COEUR-3'],
    [z, 'COEUR-6'],
  ],
  [
    [z, 'COEUR-7'],
    [x, 'COEUR-10'],
  ],
  [
    [x, 'COEUR-4'],
    [z, 'PIQUE-3'],
  ],
  [
    [x, 'PIQUE-4'],
    [z, 'ETOILE-3'],
  ],
];
