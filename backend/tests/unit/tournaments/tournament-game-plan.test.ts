import type { CardId } from '../../../src/domain/cards/card';
import type { Game } from '../../../src/domain/game/game';
import { toPlayerId, type PlayerId } from '../../../src/domain/game/game-id';
import { planGameSettlement } from '../../../src/domain/rules/game-settlement';
import {
  planTournamentGame,
  settleGameTokens,
  tournamentSettlementRule,
  type TournamentSettlementRule,
} from '../../../src/domain/tournaments/tournament';
import { NOW, waitingGame } from '../../fixtures/game-builders';

/**
 * Règlement d'une partie de tournoi (D-111) : MÊMES règles qu'une partie ordinaire (perte M,
 * 2M en Kora, fuyards d'une partie à 3 ou 4 non réglés, adversaire couché à 2 payant), sur le
 * compte FICTIF, sans commission ; toute incohérence = VOID sans aucun mouvement.
 */

const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(toPlayerId) as [PlayerId, PlayerId, PlayerId, PlayerId];
const STAKE = 100;
const RULE: TournamentSettlementRule = 'D111_ORDINARY_RULES';

/** Partie terminée : cartes du 5e tour, gagnant = contrôleur (même fabrique que D-074). */
function finishedGame(lastTrick: Record<string, CardId>, winner: PlayerId, opts: Partial<Game> = {}): Game {
  const game = waitingGame(Object.keys(lastTrick));
  return {
    ...game,
    status: 'finished',
    startedAt: NOW,
    finishedAt: NOW,
    endReason: 'CONTROL_AFTER_LAST_TRICK',
    result: {
      winnerId: winner,
      method: 'CONTROL_AFTER_LAST_TRICK',
      remainingOpponentIds: game.players.map((p) => p.playerId).filter((id) => id !== winner),
      fledPlayerIds: [],
    },
    play: {
      dealOrder: game.players.map((p) => p.playerId),
      hands: {},
      stock: [],
      trickNumber: 5,
      trickOrder: [],
      currentTrick: [],
      completedTricks: [
        {
          number: 5,
          plays: Object.entries(lastTrick).map(([playerId, cardId]) => ({
            playerId: playerId as PlayerId,
            cardId,
          })),
          controllerId: winner,
        },
      ],
      control: { playerId: winner },
    },
    ...opts,
  };
}

const tokens = (...ids: PlayerId[]) => new Map<string, number>(ids.map((id) => [id, 1000]));
const plan = (game: Game, map = tokens(...game.players.map((p) => p.playerId))) =>
  planTournamentGame({ game, stake: STAKE, rule: RULE, tokensByPlayer: map });

describe('mêmes règles qu’une partie ordinaire, compte fictif, sans commission', () => {
  it('victoire simple à 3 : chaque perdant perd M, le gagnant reçoit tout (comme D-074 à 0 %)', () => {
    const game = finishedGame({ a: 'COEUR-7', b: 'COEUR-5', c: 'PIQUE-4' }, A);
    const ordinary = planGameSettlement({
      stake: STAKE,
      commissionBps: 0,
      winnerId: A,
      participants: [A, B, C],
      victoryType: 'SIMPLE',
    });
    expect(plan(game)).toEqual({
      status: 'SETTLED',
      winnerId: A,
      victoryType: 'SIMPLE',
      transfers: { b: -ordinary.unitAmount, c: -ordinary.unitAmount, a: ordinary.netGain },
      pot: ordinary.grossAmount + ordinary.unitAmount,
    });
  });

  it('Kora (5e tour remporté avec un 3) : chaque perdant perd 2M, comme une partie ordinaire', () => {
    const game = finishedGame({ a: 'COEUR-3', b: 'PIQUE-6' }, A);
    expect(plan(game)).toMatchObject({
      victoryType: 'KORA',
      transfers: { a: 200, b: -200 },
      pot: 400,
    });
  });

  it('fuyard d’une partie à 4 : ni débité ni compté (participants réglés de D-074)', () => {
    const game = finishedGame({ a: 'COEUR-7', b: 'COEUR-5', c: 'PIQUE-4', d: 'PIQUE-6' }, A);
    game.players = game.players.map((p) => (p.playerId === D ? { ...p, fledAt: NOW } : p));
    const result = plan(game);
    expect(result).toMatchObject({ transfers: { a: 200, b: -100, c: -100 } });
    expect(result.status === 'SETTLED' && Object.keys(result.transfers).sort()).toEqual(['a', 'b', 'c']);
  });

  it('partie à 2, adversaire couché (D-086) : le fuyard paie sa mise', () => {
    const game = finishedGame({ a: 'COEUR-7', b: 'COEUR-5' }, A, {
      endReason: 'OPPONENT_FLED',
      result: { winnerId: A, method: 'OPPONENT_FLED', remainingOpponentIds: [], fledPlayerIds: [B] },
    });
    game.players = game.players.map((p) => (p.playerId === B ? { ...p, fledAt: NOW } : p));
    expect(plan(game)).toMatchObject({ victoryType: 'SIMPLE', transfers: { a: 100, b: -100 } });
  });

  it('jamais de solde négatif ni de jetons créés : un perdant paie au plus ses jetons', () => {
    const game = finishedGame({ a: 'COEUR-3', b: 'PIQUE-6' }, A);
    const result = plan(game, new Map([[A, 1000], [B, 150]]));
    expect(result).toMatchObject({ transfers: { a: 150, b: -150 }, pot: 350 });
    if (result.status === 'SETTLED') {
      expect(Object.values(result.transfers).reduce((x, y) => x + y, 0)).toBe(0);
    }
  });
});

describe('contexte invalide : VOID, aucun mouvement', () => {
  it('sans gagnant (égalité rejouée, arrêt) : VOID avec le motif de fin', () => {
    const game = { ...finishedGame({ a: 'COEUR-7', b: 'COEUR-5' }, A), result: undefined, endReason: 'ADMIN_STOP' } as Game;
    expect(plan(game)).toEqual({ status: 'VOID', voidReason: 'ADMIN_STOP' });
  });

  it('un participant réglé sans compte de CE tournoi : VOID (jamais un règlement partiel)', () => {
    const game = finishedGame({ a: 'COEUR-7', b: 'COEUR-5', c: 'PIQUE-4' }, A);
    expect(plan(game, tokens(A, B))).toEqual({ status: 'VOID', voidReason: 'PARTICIPANT_WITHOUT_ACCOUNT' });
  });

  it('gagnant hors des participants réglés (fuyard) : VOID', () => {
    const game = finishedGame({ a: 'COEUR-7', b: 'COEUR-5', c: 'PIQUE-4' }, A);
    game.players = game.players.map((p) => (p.playerId === A ? { ...p, fledAt: NOW } : p));
    expect(plan(game)).toEqual({ status: 'VOID', voidReason: 'WINNER_NOT_PARTICIPANT' });
  });

  it('partie non terminée : VOID', () => {
    const game = { ...finishedGame({ a: 'COEUR-7', b: 'COEUR-5' }, A), status: 'in_progress' } as Game;
    expect(plan(game).status).toBe('VOID');
  });
});

describe('règle figée au démarrage', () => {
  it('tournoi démarré avant D-111 : règle d’origine (D-054, « tapis ») inchangée', () => {
    const game = finishedGame({ a: 'COEUR-3', b: 'PIQUE-6', c: 'PIQUE-4' }, A);
    game.players = game.players.map((p) => (p.playerId === C ? { ...p, fledAt: NOW } : p));
    const map = tokens(A, B, C);
    expect(
      planTournamentGame({ game, stake: STAKE, rule: 'D054_TAPIS', tokensByPlayer: map }),
    ).toEqual({ status: 'SETTLED', winnerId: A, ...settleGameTokens(STAKE, A, map) });
  });

  it('règle d’un tournoi : figée, sinon D-054 si déjà démarré, sinon la règle courante', () => {
    expect(tournamentSettlementRule({ settlementRule: 'D054_TAPIS', startedAt: NOW })).toBe('D054_TAPIS');
    expect(tournamentSettlementRule({ startedAt: NOW })).toBe('D054_TAPIS');
    expect(tournamentSettlementRule({})).toBe('D111_ORDINARY_RULES');
  });
});
