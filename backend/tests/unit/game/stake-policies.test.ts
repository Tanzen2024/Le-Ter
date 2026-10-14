import type { Game } from '../../../src/domain/game/game';
import { toPlayerId, type PlayerId } from '../../../src/domain/game/game-id';
import {
  hasBalanceForStake,
  InsufficientBalanceForStakeError,
  InvalidGameStakeError,
  isValidGameStake,
  requiredBalanceForStake,
} from '../../../src/domain/rules/stake';
import type { SessionId } from '../../../src/domain/sessions/session';
import {
  allSessionAdmissions,
  allSessionContinuations,
  walletGameStakePolicy,
  walletSessionStakeAdmission,
  walletStakeContinuation,
} from '../../../src/services/game/stake-policies';
import type { SessionContinuationPolicy } from '../../../src/services/sessions/session.service';
import { waitingGame } from '../../fixtures/game-builders';

/** Mise des parties ordinaires (D-073) : règle pure et politiques, sans base. */

const alice = toPlayerId('alice');
const bob = toPlayerId('bob');
const ORDINARY = 'ordinary-session' as SessionId;
const TOURNAMENT = 'tournament-session' as SessionId;

function deps(balances: Record<string, number>) {
  const reads: string[] = [];
  return {
    reads,
    wallets: {
      getBalances: async (userId: string) => {
        reads.push(userId);
        return { available: balances[userId] ?? 0 };
      },
    },
    tournamentOfSession: async (id: SessionId) => (id === TOURNAMENT ? 'tournament-1' : null),
  };
}

const gameAt = (sessionId: SessionId, stakeAmount?: number): Game => ({
  ...waitingGame([alice], 4),
  sessionId,
  ...(stakeAmount !== undefined && { stakeAmount }),
});

describe('Règle de mise (D-073)', () => {
  it('mise valide : entier > 0, plafond technique dont le double reste sûr', () => {
    for (const v of [1, 100, 1_000_000_000]) expect(isValidGameStake(v)).toBe(true);
    for (const v of [
      0,
      -0,
      -1,
      1.5,
      NaN,
      Infinity,
      -Infinity,
      null,
      undefined,
      '1',
      1_000_000_001,
    ]) {
      expect(isValidGameStake(v)).toBe(false);
    }
    expect(Number.isSafeInteger(requiredBalanceForStake(1_000_000_000))).toBe(true);
  });

  it.each([
    [100, 199, false],
    [100, 200, true],
    [100, 500, true],
    [1, 1, false],
    [1, 2, true],
  ])('mise %i, solde %i → %s', (stake, available, ok) => {
    expect(hasBalanceForStake(available, stake)).toBe(ok);
  });

  it('solde non entier ou non fini : jamais suffisant', () => {
    expect(hasBalanceForStake(NaN, 1)).toBe(false);
    expect(hasBalanceForStake(Infinity, 1)).toBe(false);
  });
});

describe('walletGameStakePolicy', () => {
  it('partie ordinaire : mise invalide ou absente → InvalidGameStakeError, sans lire le solde', async () => {
    const d = deps({ alice: 1_000 });
    const policy = walletGameStakePolicy(d);
    await expect(policy.assertCanStake(alice, gameAt(ORDINARY))).rejects.toThrow(
      InvalidGameStakeError,
    );
    await expect(policy.assertCanStake(alice, gameAt(ORDINARY, 0))).rejects.toThrow(
      InvalidGameStakeError,
    );
    expect(d.reads).toEqual([]);
  });

  it('solde disponible < 2 × mise → InsufficientBalanceForStakeError ; = 2 × mise → accepté', async () => {
    const policy = walletGameStakePolicy(deps({ alice: 199, bob: 200 }));
    await expect(policy.assertCanStake(alice, gameAt(ORDINARY, 100))).rejects.toMatchObject({
      name: 'InsufficientBalanceForStakeError',
      stake: 100,
      required: 200,
    });
    await expect(policy.assertCanStake(bob, gameAt(ORDINARY, 100))).resolves.toBeUndefined();
  });

  it('table de tournoi : jetons de tournoi, ni mise ni solde contrôlés', async () => {
    const d = deps({});
    await expect(
      walletGameStakePolicy(d).assertCanStake(alice, gameAt(TOURNAMENT)),
    ).resolves.toBeUndefined();
    expect(d.reads).toEqual([]);
  });
});

describe('walletSessionStakeAdmission', () => {
  const admission = (balances: Record<string, number>, stake: number | undefined | null) =>
    walletSessionStakeAdmission({ ...deps(balances), lastStakeOfSession: async () => stake });

  it('mise de la dernière partie de la table, solde du joueur', async () => {
    await expect(admission({ bob: 199 }, 100).assertCanJoin(ORDINARY, bob)).rejects.toThrow(
      InsufficientBalanceForStakeError,
    );
    await expect(
      admission({ bob: 200 }, 100).assertCanJoin(ORDINARY, bob),
    ).resolves.toBeUndefined();
  });

  it('table antérieure sans mise → refusée ; table sans partie → laissée à l’entrée en partie', async () => {
    await expect(admission({ bob: 1_000 }, undefined).assertCanJoin(ORDINARY, bob)).rejects.toThrow(
      InvalidGameStakeError,
    );
    await expect(admission({ bob: 0 }, null).assertCanJoin(ORDINARY, bob)).resolves.toBeUndefined();
  });

  it('table de tournoi : non concernée', async () => {
    await expect(admission({}, undefined).assertCanJoin(TOURNAMENT, bob)).resolves.toBeUndefined();
  });
});

describe('walletStakeContinuation (partie suivante, D-042)', () => {
  it('écarte les joueurs dont le solde ne couvre plus 2 × la mise', async () => {
    const policy = walletStakeContinuation(deps({ alice: 200, bob: 199 }));
    expect(await policy.allowsNewGame(ORDINARY)).toBe(true);
    expect(
      await policy.playersBarredFromNextGame!(ORDINARY, [alice, bob], gameAt(ORDINARY, 100)),
    ).toEqual([bob]);
  });

  it('partie précédente sans mise valide : tout le monde est écarté', async () => {
    const policy = walletStakeContinuation(deps({ alice: 1_000, bob: 1_000 }));
    expect(
      await policy.playersBarredFromNextGame!(ORDINARY, [alice, bob], gameAt(ORDINARY, 0)),
    ).toEqual([alice, bob]);
  });

  it('table de tournoi : personne n’est écarté par le compte de jeu', async () => {
    const policy = walletStakeContinuation(deps({}));
    expect(
      await policy.playersBarredFromNextGame!(TOURNAMENT, [alice, bob], gameAt(TOURNAMENT)),
    ).toEqual([]);
  });

  it('une erreur technique (lecture du solde) n’est pas transformée en refus', async () => {
    const policy = walletStakeContinuation({
      wallets: { getBalances: async () => Promise.reject(new Error('db down')) },
      tournamentOfSession: async () => null,
    });
    await expect(
      policy.playersBarredFromNextGame!(ORDINARY, [alice], gameAt(ORDINARY, 100)),
    ).rejects.toThrow('db down');
  });
});

describe('walletStakeContinuation.assertCanContinue (« Poursuivre », D-073)', () => {
  const check = (available: number, stake: number) =>
    walletStakeContinuation(deps({ bob: available })).assertCanContinue!(
      ORDINARY,
      bob,
      gameAt(ORDINARY, stake),
    );

  it.each([
    [500, 250],
    [501, 250],
    [2_000, 1_000],
  ])('solde %i, mise %i : autorisé (≥ 2 × mise)', async (available, stake) => {
    await expect(check(available, stake)).resolves.toBeUndefined();
  });

  it.each([
    [460, 250],
    [499, 250],
    [1_999, 1_000],
    [0, 250],
  ])('solde %i, mise %i : refusé', async (available, stake) => {
    await expect(check(available, stake)).rejects.toThrow(InsufficientBalanceForStakeError);
  });

  it('table de tournoi : non concernée ; mise invalide : refusée', async () => {
    const policy = walletStakeContinuation(deps({}));
    await expect(
      policy.assertCanContinue!(TOURNAMENT, bob, gameAt(TOURNAMENT)),
    ).resolves.toBeUndefined();
    await expect(check(1_000, 0)).rejects.toThrow(InvalidGameStakeError);
  });

  it('une erreur technique reste une erreur technique (pas un refus de solde)', async () => {
    const policy = walletStakeContinuation({
      wallets: { getBalances: async () => Promise.reject(new Error('db down')) },
      tournamentOfSession: async () => null,
    });
    await expect(policy.assertCanContinue!(ORDINARY, bob, gameAt(ORDINARY, 100))).rejects.toThrow(
      'db down',
    );
  });

  it('combinée : le premier refus est levé', async () => {
    const ok: SessionContinuationPolicy = { allowsNewGame: async () => true };
    const both = allSessionContinuations(ok, walletStakeContinuation(deps({ bob: 460 })));
    await expect(both.assertCanContinue!(ORDINARY, bob, gameAt(ORDINARY, 250))).rejects.toThrow(
      InsufficientBalanceForStakeError,
    );
  });
});

describe('Combinaison des politiques de session', () => {
  it('arrivée : toutes doivent accepter', async () => {
    const calls: string[] = [];
    const ok = { assertCanJoin: async () => void calls.push('ok') };
    const ko = {
      assertCanJoin: async () => {
        calls.push('ko');
        throw new Error('refusé');
      },
    };
    await expect(allSessionAdmissions(ok, ko, ok).assertCanJoin(ORDINARY, bob)).rejects.toThrow(
      'refusé',
    );
    expect(calls).toEqual(['ok', 'ko']);
  });

  it('continuation : refus si l’une refuse ; écartés = union, dans l’ordre des joueurs', async () => {
    const a: SessionContinuationPolicy = {
      allowsNewGame: async () => true,
      playersBarredFromNextGame: async () => [bob],
    };
    const b: SessionContinuationPolicy = {
      allowsNewGame: async () => false,
      playersBarredFromNextGame: async () => [alice, bob],
    };
    const both = allSessionContinuations(a, b);
    expect(await both.allowsNewGame(ORDINARY)).toBe(false);
    const players: PlayerId[] = [bob, alice];
    expect(await both.playersBarredFromNextGame!(ORDINARY, players, gameAt(ORDINARY, 1))).toEqual([
      bob,
      alice,
    ]);
  });
});
