import { randomUUID } from 'node:crypto';

import type { PlayerId } from '../../../src/domain/game/game-id';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Mise des parties ordinaires (D-073), de bout en bout (HTTP → services → PostgreSQL) :
 * mise entière > 0 et solde DISPONIBLE du compte de jeu ≥ 2 × mise, relus côté serveur, à la
 * création comme à la participation. Un refus ne crée rien et ne déplace aucun jeton.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
    stakePolicies: true,
  });
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

async function newPlayer(balance?: number) {
  const session = await registerAndLogin(ctx.app);
  if (balance !== undefined) {
    await database.sql.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())`,
      [session.userId, balance],
    );
  }
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

const count = async (table: 'games' | 'sessions') =>
  Number((await database.sql.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

const balanceOf = async (p: Player) =>
  Number(
    (
      await database.sql.query<{ balance: string }>(
        'SELECT balance FROM wallets WHERE user_id = $1',
        [p.userId],
      )
    ).rows[0]?.balance ?? 0,
  );

const walletTransactions = async () =>
  Number(
    (await database.sql.query<{ n: string }>('SELECT count(*) AS n FROM wallet_transactions'))
      .rows[0]!.n,
  );

async function createTable(owner: Player, stakeAmount: number, maxPlayers = 4) {
  const res = await expectStatus(
    owner.api.post('/api/sessions', { maxPlayers, name: 'Table', stakeAmount }),
    201,
  );
  return {
    sessionId: res.body.session.sessionId as string,
    gameId: res.body.game.gameId as string,
  };
}

const activePlayers = async (sessionId: string) =>
  Number(
    (
      await database.sql.query<{ n: string }>(
        'SELECT count(*) AS n FROM session_players WHERE session_id = $1 AND left_at IS NULL',
        [sessionId],
      )
    ).rows[0]!.n,
  );

describe('Création d’une partie (D-073)', () => {
  it.each(['/api/sessions', '/api/games'])(
    '%s : mise nulle, négative, vide, null, décimale ou chaîne → 400, rien n’est créé',
    async (path) => {
      const A = await newPlayer(1_000);
      for (const stakeAmount of [0, -100, null, '', '100', 1.5, 'abc']) {
        const res = await A.api.post(path, { maxPlayers: 2, stakeAmount });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.fields.stakeAmount).toBe(
          'La mise doit être un nombre entier supérieur à zéro.',
        );
      }
      expect(await count('games')).toBe(0);
      expect(await count('sessions')).toBe(0);
    },
  );

  it.each(['/api/sessions', '/api/games'])(
    '%s : mise absente → 400 STAKE_INVALID, rien n’est créé',
    async (path) => {
      const A = await newPlayer(1_000);
      const res = await A.api.post(path, { maxPlayers: 2 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('STAKE_INVALID');
      expect(res.body.message).toBe('La mise doit être supérieure à zéro.');
      expect(await count('games')).toBe(0);
      expect(await count('sessions')).toBe(0);
    },
  );

  it('solde 199 pour une mise de 100 → 409, aucune partie, aucun mouvement', async () => {
    const A = await newPlayer(199);
    const res = await A.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'INSUFFICIENT_BALANCE_FOR_STAKE',
      message: "Vous devez disposer d'au moins 200 jetons pour jouer avec une mise de 100 jetons.",
      details: { stake: 100, requiredBalance: 200 },
    });
    expect(await count('games')).toBe(0);
    expect(await count('sessions')).toBe(0);
    expect(await balanceOf(A)).toBe(199);
    expect(await walletTransactions()).toBe(0);
  });

  it('aucun portefeuille (solde 0) → 409', async () => {
    const A = await newPlayer();
    const res = await A.api.post('/api/games', { maxPlayers: 2, stakeAmount: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE_FOR_STAKE');
    expect(await count('games')).toBe(0);
  });

  it.each([200, 500])('solde %i pour une mise de 100 → créée, solde inchangé', async (balance) => {
    const A = await newPlayer(balance);
    const res = await expectStatus(
      A.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100 }),
      201,
    );
    expect(res.body.game.stakeAmount).toBe(100);
    expect(await count('games')).toBe(1);
    expect(await balanceOf(A)).toBe(balance);
    expect(await walletTransactions()).toBe(0);
  });

  it('le solde envoyé par le client est ignoré', async () => {
    const A = await newPlayer(10);
    const res = await A.api.post('/api/sessions', {
      maxPlayers: 2,
      stakeAmount: 100,
      balance: 1_000_000,
      availableBalance: 1_000_000,
    });
    expect(res.status).toBe(409);
    expect(await count('games')).toBe(0);
  });

  it('les réservations de tournoi ne comptent pas dans le solde disponible', async () => {
    const A = await newPlayer(300);
    // Montant réservé simulé : seul `available = balance − reserved` est lu.
    await database.sql.query('UPDATE wallets SET reserved = 150 WHERE user_id = $1', [A.userId]);
    const res = await A.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE_FOR_STAKE');
  });
});

describe('Rejoindre une partie (D-073)', () => {
  it('solde 199 : refusé à l’arrivée à la table, aucun siège occupé', async () => {
    const A = await newPlayer(1_000);
    const B = await newPlayer(199);
    const { sessionId, gameId } = await createTable(A, 100);
    const res = await B.api.post(`/api/sessions/${sessionId}/join`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE_FOR_STAKE');
    expect(await activePlayers(sessionId)).toBe(1);
    // Contourner l'écran en appelant directement l'entrée dans la partie : même refus.
    const direct = await B.api.post(`/api/games/${gameId}/join`, { stakeAmount: 1 });
    expect(direct.status).toBe(409);
    expect(direct.body.code).toBe('INSUFFICIENT_BALANCE_FOR_STAKE');
    const { body } = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    expect(body.game.players).toHaveLength(1);
  });

  it.each([200, 500])('solde %i pour une mise de 100 : table puis partie rejointes', async (balance) => {
    const A = await newPlayer(1_000);
    const B = await newPlayer(balance);
    const { sessionId, gameId } = await createTable(A, 100);
    await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
    await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);
    expect(await balanceOf(B)).toBe(balance);
    expect(await walletTransactions()).toBe(0);
  });

  it('la mise lue est celle de la partie enregistrée, pas celle du client', async () => {
    const A = await newPlayer(10_000);
    const B = await newPlayer(1_000);
    const { sessionId } = await createTable(A, 1_000);
    const res = await B.api.post(`/api/sessions/${sessionId}/join`, { stakeAmount: 1 });
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({ stake: 1_000, requiredBalance: 2_000 });
  });

  it('solde passé sous le seuil après l’arrivée à la table : entrée dans la partie refusée', async () => {
    const A = await newPlayer(1_000);
    const B = await newPlayer(200);
    const { sessionId, gameId } = await createTable(A, 100);
    await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
    await database.sql.query('UPDATE wallets SET balance = 150 WHERE user_id = $1', [B.userId]);
    const res = await B.api.post(`/api/games/${gameId}/join`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE_FOR_STAKE');
  });

  it('participations concurrentes : une place, un seul joueur ; aucun jeton déplacé', async () => {
    const A = await newPlayer(1_000);
    const [B, C] = [await newPlayer(200), await newPlayer(200)];
    const { sessionId, gameId } = await createTable(A, 100, 2);
    const results = await Promise.all(
      [B, C, B, C].map((p) => p.api.post(`/api/sessions/${sessionId}/join`)),
    );
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(await activePlayers(sessionId)).toBe(2);
    const seated = (await Promise.all(
      [B, C].map(async (p) => ({ p, res: await p.api.post(`/api/games/${gameId}/join`) })),
    )).filter(({ res }) => res.status === 200);
    expect(seated).toHaveLength(1);
    const { body } = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    expect(body.game.players).toHaveLength(2);
    expect([await balanceOf(A), await balanceOf(B), await balanceOf(C)]).toEqual([1_000, 200, 200]);
    expect(await walletTransactions()).toBe(0);
  });

  it('double clic sur « rejoindre » : une seule place occupée', async () => {
    const A = await newPlayer(1_000);
    const B = await newPlayer(200);
    const { sessionId, gameId } = await createTable(A, 100);
    await Promise.all([1, 2, 3].map(() => B.api.post(`/api/sessions/${sessionId}/join`)));
    expect(await activePlayers(sessionId)).toBe(2);
    await Promise.all([1, 2, 3].map(() => B.api.post(`/api/games/${gameId}/join`)));
    const { body } = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    expect(body.game.players).toHaveLength(2);
  });
});

describe('Partie suivante après « Poursuivre » (D-042, D-073)', () => {
  /** Distribution « identité » à 2 : B gagne (voir continue-next-game.test.ts). */
  const SECOND_WINS: [0 | 1, string][] = [
    [0, 'COEUR-3'],
    [1, 'COEUR-6'],
    [1, 'PIQUE-3'],
    [0, 'COEUR-9'],
    [1, 'PIQUE-4'],
    [0, 'COEUR-10'],
    [1, 'COEUR-7'],
    [0, 'COEUR-4'],
  ];

  beforeEach(async () => {
    await ctx.stopTimers();
    ctx = createGameApiTestApp(database.sql, {
      rules: testRules,
      random: identityRandom,
      decisionWindowMs: 60_000,
      turnDurationMs: 60_000,
      stakePolicies: true,
      autoNextGame: true,
    });
  });

  it('un joueur dont le solde est passé sous 2 × la mise est écarté ; la partie suivante attend', async () => {
    const A = await newPlayer(1_000);
    const B = await newPlayer(200);
    const { sessionId, gameId } = await createTable(A, 100, 2);
    await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
    await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);
    await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
    for (const [who, cardId] of SECOND_WINS) {
      await expectStatus(
        (who === 0 ? A : B).api.post(`/api/games/${gameId}/actions`, {
          commandId: randomUUID(),
          type: 'PLAY_CARD',
          payload: { cardId },
        }),
        200,
      );
    }
    // Retrait (simulé) pendant la ronde : B n'a plus 2 × la mise.
    await database.sql.query('UPDATE wallets SET balance = 199 WHERE user_id = $1', [B.userId]);
    await expectStatus(A.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }), 200);
    await expectStatus(B.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }), 200);
    await ctx.sessions.idle();

    const until = Date.now() + 5_000;
    let next: { gameId: string; status: string; playerIds: string[] } | null = null;
    while (!next && Date.now() < until) {
      const { body } = await expectStatus(A.api.get(`/api/sessions/${sessionId}`), 200);
      if (body.session.currentGame && body.session.currentGame.gameId !== gameId) {
        next = body.session.currentGame;
      } else await new Promise((r) => setTimeout(r, 50));
    }
    expect(next).not.toBeNull();
    expect(next!.playerIds).toEqual([A.id]);
    expect(next!.status).toBe('waiting');
    expect(await activePlayers(sessionId)).toBe(1);
    const { body } = await expectStatus(A.api.get(`/api/games/${next!.gameId}`), 200);
    expect(body.game.stakeAmount).toBe(100);
    expect(await balanceOf(B)).toBe(199);
    // D-074 : seule la partie TERMINÉE est réglée (1 mise du perdant + 1 gain ; le gagnant
    // garde sa mise) ; la partie suivante, en attente, n'a ni séquestre ni mouvement.
    expect(await walletTransactions()).toBe(2);
    const nextMoves = await database.sql.query(
      'SELECT 1 FROM wallet_transactions WHERE game_id = $1',
      [next!.gameId],
    );
    expect(nextMoves.rows).toHaveLength(0);
  });
});
