import {
  DEFAULT_RANKING_WEIGHTS,
  rankTournamentAccounts,
  reconcileAccountsWithLedger,
  type RankingRules,
  type TournamentAccountStatus,
  type TournamentGameTally,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';

/**
 * Compteurs du classement recalculés sur le registre des parties réglées (D-106) : le total
 * de parties est celui du TOURNOI (toutes tables), jamais celui d'une table ; le registre fait
 * foi sur un compteur en cache qui a dérivé.
 */
const RULES: RankingRules = {
  method: 'D106_CAPITAL_RATIO',
  weights: DEFAULT_RANKING_WEIGHTS,
  tokensReference: 1000,
  gamesReference: 5,
};
const STAKE = 100;

const acc = (
  playerId: string,
  o: { currentTokens?: number; gamesPlayed?: number; gamesWon?: number } = {},
) => ({
  playerId: playerId as UserId,
  initialTokens: 1000,
  currentTokens: 1000,
  gamesPlayed: 0,
  gamesWon: 0,
  status: 'ACTIVE' as TournamentAccountStatus,
  registeredAt: new Date('2026-10-10T10:00:00Z'),
  ...o,
});

const ledger = (entries: [string, TournamentGameTally][]) => new Map(entries);

describe('reconcileAccountsWithLedger', () => {
  it('compteurs déjà justes : comptes inchangés, aucune dérive', () => {
    const accounts = [acc('a', { currentTokens: 1100, gamesPlayed: 3, gamesWon: 2 }), acc('b')];
    const result = reconcileAccountsWithLedger(
      accounts,
      ledger([['a', { gamesPlayed: 3, gamesWon: 2, tokenDelta: 100 }]]),
      STAKE,
    );
    expect(result.drifted).toEqual([]);
    expect(result.accounts[0]).toBe(accounts[0]);
    expect(result.accounts[1]).toBe(accounts[1]);
  });

  it('compteur limité à la dernière table : le total du tournoi le remplace', () => {
    // 4 parties sur 3 tables ; le cache n'en a retenu qu'une.
    const stale = acc('a', { currentTokens: 1100, gamesPlayed: 1, gamesWon: 1 });
    const { accounts, drifted } = reconcileAccountsWithLedger(
      [stale],
      ledger([['a', { gamesPlayed: 4, gamesWon: 3, tokenDelta: 200 }]]),
      STAKE,
    );
    expect(accounts[0]).toMatchObject({ gamesPlayed: 4, gamesWon: 3, currentTokens: 1200 });
    expect(drifted).toEqual([stale]);
  });

  it('joueur absent du registre : 0 partie, capital initial', () => {
    const { accounts } = reconcileAccountsWithLedger(
      [acc('a', { currentTokens: 900, gamesPlayed: 2 })],
      new Map(),
      STAKE,
    );
    expect(accounts[0]).toMatchObject({ gamesPlayed: 0, gamesWon: 0, currentTokens: 1000 });
  });

  it('statut recalculé avec les jetons du registre (seuil de 2 mises, D-063)', () => {
    const { accounts } = reconcileAccountsWithLedger(
      [acc('a')],
      ledger([['a', { gamesPlayed: 9, gamesWon: 0, tokenDelta: -900 }]]),
      STAKE,
    );
    expect(accounts[0]).toMatchObject({ currentTokens: 100, status: 'OUT_OF_TOKENS' });
  });

  it('le classement utilise le total global des parties et les jetons finaux', () => {
    // Même jetons ; a a joué 4 parties sur plusieurs tables, b 1 : a devant b.
    const { accounts } = reconcileAccountsWithLedger(
      [acc('a', { gamesPlayed: 1 }), acc('b', { gamesPlayed: 1 })],
      ledger([
        ['a', { gamesPlayed: 4, gamesWon: 2, tokenDelta: 0 }],
        ['b', { gamesPlayed: 1, gamesWon: 0, tokenDelta: 0 }],
      ]),
      STAKE,
    );
    const ranked = rankTournamentAccounts(accounts, RULES);
    expect(ranked.map((r) => [r.playerId, r.gamesPlayed])).toEqual([
      ['a', 4],
      ['b', 1],
    ]);
    expect(ranked[0]!.gamesRatio).toBeCloseTo(0.8);
  });
});
