import type { CardId } from '../../../src/domain/cards/card';
import type { Game } from '../../../src/domain/game/game';
import { toPlayerId, type PlayerId } from '../../../src/domain/game/game-id';
import {
  commissionBpsForStake,
  commissionOf,
  commissionPercentToBps,
  commissionScheduleError,
  DEFAULT_GAME_COMMISSION_SCHEDULE,
  isValidCommissionPercent,
  normalizeCommissionSchedule,
  planGameSettlement,
  reservedPerPlayer,
  settledParticipants,
  victoryTypeOf,
} from '../../../src/domain/rules/game-settlement';
import { NOW, waitingGame } from '../../fixtures/game-builders';

/**
 * Règlement des parties ordinaires (D-074, D-080) : commission sur les mises des PERDANTS au
 * taux de la tranche de la mise (la Kora double la perte, JAMAIS le taux), Kora détectée sur
 * l'état officiel, arrondis entiers, conservation des jetons (Σ pertes = gain net + commission).
 */

const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(toPlayerId) as [
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
];
const FOUR = [A, B, C, D];

/** Partie terminée : 5e tour donné (cartes du dernier tour), gagnant = contrôleur. */
function finishedGame(
  lastTrick: Record<string, CardId>,
  winner: PlayerId,
  opts: Partial<Game> = {},
): Game {
  const game = waitingGame(Object.keys(lastTrick));
  const plays = Object.entries(lastTrick).map(([playerId, cardId]) => ({
    playerId: playerId as PlayerId,
    cardId,
  }));
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
      completedTricks: [{ number: 5, plays, controllerId: winner }],
      control: { playerId: winner },
    },
    ...opts,
  };
}

describe('Exemple du propriétaire : 3 joueurs, mise 50, commission 2 %', () => {
  const bps = commissionPercentToBps(2);
  const base = { stake: 50, commissionBps: bps, winnerId: A, participants: [A, B, C] };

  it('victoire simple : commission 2 % × (50 + 50) = 2, A reçoit 98', () => {
    const plan = planGameSettlement({ ...base, victoryType: 'SIMPLE' });
    expect(plan).toMatchObject({
      loserIds: [B, C],
      unitAmount: 50,
      grossAmount: 100,
      commissionBps: 200,
      appliedCommissionBps: 200,
      commissionAmount: 2,
      netGain: 98,
    });
  });

  it('victoire par Kora : chaque perdant perd 100, taux inchangé 2 % × 200 = 4, A reçoit 196', () => {
    const plan = planGameSettlement({ ...base, victoryType: 'KORA' });
    expect(plan).toMatchObject({
      unitAmount: 100,
      grossAmount: 200,
      commissionBps: 200,
      appliedCommissionBps: 200,
      commissionAmount: 4,
      netGain: 196,
    });
  });

  it('conservation : perdants + gagnant + plateforme = 0 (le gagnant garde sa mise)', () => {
    for (const victoryType of ['SIMPLE', 'KORA'] as const) {
      const plan = planGameSettlement({ ...base, victoryType });
      const losers = -plan.unitAmount * plan.loserIds.length;
      expect(losers + plan.netGain + plan.commissionAmount).toBe(0);
    }
  });
});

describe('Exemple de référence D-080 : Roly 3 682, Lamat 7 710, mise 500, taux 6 %', () => {
  const [roly, lamat] = [toPlayerId('roly'), toPlayerId('lamat')];
  const base = {
    stake: 500,
    commissionBps: commissionPercentToBps(6),
    winnerId: lamat,
    participants: [roly, lamat],
  };
  const balances = (plan: ReturnType<typeof planGameSettlement>) => ({
    roly: 3_682 - plan.unitAmount,
    lamat: 7_710 + plan.netGain,
    platform: plan.commissionAmount,
  });

  it('victoire simple de Lamat : Roly 3 182, Lamat 8 180, plateforme +30', () => {
    expect(balances(planGameSettlement({ ...base, victoryType: 'SIMPLE' }))).toEqual({
      roly: 3_182,
      lamat: 8_180,
      platform: 30,
    });
  });

  it('Kora de Lamat : perte doublée, taux 6 % inchangé → Roly 2 682, Lamat 8 650, plateforme +60', () => {
    const plan = planGameSettlement({ ...base, victoryType: 'KORA' });
    expect(plan.appliedCommissionBps).toBe(600);
    expect(balances(plan)).toEqual({ roly: 2_682, lamat: 8_650, platform: 60 });
  });
});

describe('Toutes les valeurs de taux : commission = floor(perte totale × taux), quel que soit le type', () => {
  const rates = [0, 1, 25, 100, 250, 600, 1_000, 3_333, 5_000, 9_999, 10_000];
  const stakes = [1, 7, 99, 500, 1_001, 1_000_000_000];
  for (const victoryType of ['SIMPLE', 'KORA'] as const) {
    it(`${victoryType} : 2 à 4 joueurs, mises et taux variés, conservation exacte`, () => {
      for (const bps of rates) {
        for (const stake of stakes) {
          for (const n of [2, 3, 4]) {
            const plan = planGameSettlement({
              stake,
              commissionBps: bps,
              winnerId: A,
              participants: FOUR.slice(0, n),
              victoryType,
            });
            const loss = (victoryType === 'KORA' ? 2 : 1) * stake;
            const gross = loss * (n - 1);
            expect(plan.unitAmount).toBe(loss);
            expect(plan.grossAmount).toBe(gross);
            expect(plan.appliedCommissionBps).toBe(bps);
            expect(plan.commissionAmount).toBe(Number((BigInt(gross) * BigInt(bps)) / 10_000n));
            expect(plan.commissionAmount).toBeGreaterThanOrEqual(0);
            expect(plan.netGain).toBeGreaterThanOrEqual(0);
            expect(plan.netGain + plan.commissionAmount).toBe(gross);
          }
        }
      }
    });
  }

  it('la commission d’une Kora est exactement celle d’une perte doublée au même taux', () => {
    for (const bps of rates) {
      const simple = planGameSettlement({
        stake: 1_000,
        commissionBps: bps,
        winnerId: A,
        participants: [A, B],
        victoryType: 'SIMPLE',
      });
      const kora = planGameSettlement({
        stake: 2_000,
        commissionBps: bps,
        winnerId: A,
        participants: [A, B],
        victoryType: 'SIMPLE',
      });
      expect(
        planGameSettlement({
          stake: 1_000,
          commissionBps: bps,
          winnerId: A,
          participants: [A, B],
          victoryType: 'KORA',
        }).commissionAmount,
      ).toBe(kora.commissionAmount);
      expect(kora.commissionAmount).toBeGreaterThanOrEqual(simple.commissionAmount);
    }
  });
});

describe('Formules', () => {
  it('4 participants, mise 100 à 1 % : brut 300, commission 3, net 297', () => {
    const plan = planGameSettlement({
      stake: 100,
      commissionBps: 100,
      winnerId: A,
      participants: FOUR,
      victoryType: 'SIMPLE',
    });
    expect(plan).toMatchObject({
      unitAmount: 100,
      grossAmount: 300,
      commissionAmount: 3,
      netGain: 297,
    });
  });

  it('commission à 0 % : le gagnant reçoit toutes les mises des perdants', () => {
    const plan = planGameSettlement({
      stake: 5,
      commissionBps: 0,
      winnerId: A,
      participants: FOUR,
      victoryType: 'KORA',
    });
    expect(plan).toMatchObject({
      grossAmount: 30,
      appliedCommissionBps: 0,
      commissionAmount: 0,
      netGain: 30,
    });
  });

  it('arrondi à l’entier inférieur (en faveur du joueur), sans flottant', () => {
    // 2 × 7 = 14 ; 14 × 5 % = 0,7 → 0.
    const plan = planGameSettlement({
      stake: 7,
      commissionBps: 500,
      winnerId: A,
      participants: [A, B, C],
      victoryType: 'SIMPLE',
    });
    expect(plan).toMatchObject({ grossAmount: 14, commissionAmount: 0, netGain: 14 });
    expect(commissionOf(399, 500)).toBe(19); // 19,95 → 19
    expect(commissionOf(8_000_000_000, 10_000)).toBe(8_000_000_000); // grands montants exacts
    expect(commissionOf(1, 1)).toBe(0);
  });

  it('refuse un gagnant hors des participants, sans perdant, une mise ou un taux invalides', () => {
    const base = {
      stake: 100,
      commissionBps: 500,
      winnerId: A,
      participants: FOUR,
      victoryType: 'SIMPLE' as const,
    };
    expect(() => planGameSettlement({ ...base, winnerId: toPlayerId('z') })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, participants: [A] })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, stake: 0 })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, stake: -100 })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, commissionBps: 10_001 })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, commissionBps: 2.5 })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, commissionBps: -1 })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, commissionBps: Number.NaN })).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, stake: 1.5 })).toThrow(RangeError);
    expect(() =>
      planGameSettlement({ ...base, stake: Number.MAX_SAFE_INTEGER, victoryType: 'KORA' }),
    ).toThrow(RangeError);
    expect(() => planGameSettlement({ ...base, participants: [A, B, B] })).toThrow(RangeError);
    expect(() =>
      planGameSettlement({ ...base, victoryType: 'DOUBLE_KORA' as unknown as 'KORA' }),
    ).toThrow(RangeError);
    // Le taux n'est plus doublé par la Kora (D-080) : 50,01 % reste 50,01 %.
    expect(
      planGameSettlement({ ...base, commissionBps: 5_001, victoryType: 'KORA' }),
    ).toMatchObject({
      appliedCommissionBps: 5_001,
      grossAmount: 600,
      commissionAmount: 300,
    });
    // 100 % : la commission absorbe tout, jamais de gain négatif.
    expect(
      planGameSettlement({ ...base, commissionBps: 10_000, victoryType: 'KORA' }).netGain,
    ).toBe(0);
  });

  it('engagement au démarrage : 2 × la mise par joueur (perte maximale, Kora)', () => {
    expect(reservedPerPlayer(100)).toBe(200);
  });
});

describe('Barème par tranche de mise', () => {
  it('barème initial : bornes contiguës, une tranche pour chaque mise', () => {
    expect(commissionScheduleError(DEFAULT_GAME_COMMISSION_SCHEDULE)).toBeNull();
    const rate = (stake: number) =>
      commissionBpsForStake(DEFAULT_GAME_COMMISSION_SCHEDULE, stake) / 100;
    expect(
      [
        1, 5, 6, 50, 100, 101, 200, 201, 300, 301, 400, 401, 500, 501, 700, 701, 999, 1000,
        1_000_000,
      ].map(rate),
    ).toEqual([0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 6, 6, 7, 7, 8, 8, 10, 10]);
  });

  it.each([
    ['vide', []],
    ['pas une liste', { minStake: 1, maxStake: null, percent: 1 }],
    ['ne commence pas à 1', [{ minStake: 2, maxStake: null, percent: 1 }]],
    [
      'trou',
      [
        { minStake: 1, maxStake: 99, percent: 1 },
        { minStake: 101, maxStake: null, percent: 2 },
      ],
    ],
    [
      'chevauchement',
      [
        { minStake: 1, maxStake: 400, percent: 4 },
        { minStake: 351, maxStake: null, percent: 6 },
      ],
    ],
    ['dernière tranche plafonnée', [{ minStake: 1, maxStake: 100, percent: 1 }]],
    [
      'tranche intermédiaire sans plafond',
      [
        { minStake: 1, maxStake: null, percent: 1 },
        { minStake: 2, maxStake: null, percent: 2 },
      ],
    ],
    [
      'maximum < minimum',
      [
        { minStake: 1, maxStake: 0, percent: 1 },
        { minStake: 1, maxStake: null, percent: 2 },
      ],
    ],
    ['taux > 100 %', [{ minStake: 1, maxStake: null, percent: 100.01 }]],
    ['taux négatif', [{ minStake: 1, maxStake: null, percent: -1 }]],
    ['taux en chaîne', [{ minStake: 1, maxStake: null, percent: '1' }]],
    ['champ inconnu', [{ minStake: 1, maxStake: null, percent: 1, extra: true }]],
  ])('refusé : %s', (_label, value) => expect(commissionScheduleError(value)).not.toBeNull());

  it('normalisation : 5 et 5.00 sont la même valeur', () => {
    expect(normalizeCommissionSchedule([{ minStake: 1, maxStake: null, percent: 5.0 }])).toEqual([
      { minStake: 1, maxStake: null, percent: 5 },
    ]);
  });

  it.each([0, 5, 12.5, 2.25, 50, 50.01, 99.99, 100])('taux %p valide', (v) =>
    expect(isValidCommissionPercent(v)).toBe(true),
  );

  it.each([-1, 100.01, 2.345, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, ''])(
    'taux %p refusé',
    (v) => expect(isValidCommissionPercent(v)).toBe(false),
  );
});

describe('Détection de la Kora sur l’état officiel', () => {
  it('le gagnant remporte le 5e tour avec un 3 → KORA', () => {
    const game = finishedGame({ a: 'COEUR-3', b: 'PIQUE-9', c: 'TREFLE-10', d: 'ETOILE-8' }, A);
    expect(victoryTypeOf(game)).toBe('KORA');
  });

  it('le gagnant remporte le 5e tour avec une autre carte → SIMPLE', () => {
    const game = finishedGame({ a: 'COEUR-8', b: 'COEUR-3', c: 'TREFLE-3', d: 'ETOILE-3' }, A);
    expect(victoryTypeOf(game)).toBe('SIMPLE');
  });

  it('un PERDANT qui joue un 3 au dernier tour ne fait pas une Kora', () => {
    const game = finishedGame({ a: 'COEUR-9', b: 'COEUR-3', c: 'PIQUE-4', d: 'ETOILE-5' }, A);
    expect(victoryTypeOf(game)).toBe('SIMPLE');
  });

  it('victoire instantanée → toujours SIMPLE (D-035), même avec des 3 en main', () => {
    const game = finishedGame({ a: 'COEUR-3', b: 'PIQUE-9' }, A, {
      endReason: 'INSTANT_WIN',
    });
    game.result = { ...game.result!, method: 'INSTANT_WIN', victoryType: 'SIMPLE' };
    expect(victoryTypeOf(game)).toBe('SIMPLE');
  });

  it('dernier tour incohérent (pas le 5e, autre contrôleur) → SIMPLE, jamais Kora par défaut', () => {
    const game = finishedGame({ a: 'COEUR-3', b: 'PIQUE-9' }, A);
    game.play!.completedTricks[0]!.number = 4;
    expect(victoryTypeOf(game)).toBe('SIMPLE');
    const other = finishedGame({ a: 'COEUR-3', b: 'PIQUE-9' }, A);
    other.play!.completedTricks[0]!.controllerId = B;
    expect(victoryTypeOf(other)).toBe('SIMPLE');
  });

  it('partie sans gagnant (égalité, arrêt administratif) → null', () => {
    const tie = finishedGame({ a: 'COEUR-3', b: 'PIQUE-9' }, A, { endReason: 'INSTANT_WIN_TIE' });
    delete tie.result;
    expect(victoryTypeOf(tie)).toBeNull();
    const running = finishedGame({ a: 'COEUR-3', b: 'PIQUE-9' }, A, { status: 'in_progress' });
    expect(victoryTypeOf(running)).toBeNull();
  });
});

describe('Participants réglés', () => {
  it('les fuyards sont exclus (R-05 non tranché : aucun débit inventé)', () => {
    const game = finishedGame({ a: 'COEUR-9', b: 'PIQUE-9', c: 'TREFLE-9' }, A);
    game.players[2]!.fledAt = NOW;
    expect(settledParticipants(game)).toEqual([A, B]);
  });
});
