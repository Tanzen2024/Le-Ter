import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CardId } from '../../../src/domain/cards/card';
import type { Game } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import {
  PostgresGameStakeLedger,
  type GameStakeLedger,
} from '../../../src/repositories/game-stake-ledger';
import { updateGameRows } from '../../../src/repositories/postgres-game.repository';
import { PostgresWalletRepository } from '../../../src/repositories/postgres-wallet.repository';
import { lockWalletBalances, reserveFunds } from '../../../src/repositories/wallet-reservations';
import { InsufficientBalanceError } from '../../../src/domain/wallet/wallet';
import type { UserId } from '../../../src/domain/users/user';
import { InMemoryGameEventHub } from '../../../src/websocket/in-memory-game-event-hub';
import { asAdmin, createAdmin } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  enterGame,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { deckForHands, decksRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Règlement financier des parties ordinaires (D-074, D-080), de bout en bout : HTTP →
 * GameService → PostgreSQL, parties RÉELLEMENT jouées (règles officielles, mains choisies par
 * la vraie distribution). Engagement de 2 × mise au démarrage SANS aucun changement de solde
 * ni de disponible affichés ; règlement dans la transaction de fin : commission sur les
 * pertes des PERDANTS au taux de la tranche de la mise (barème initial : 100 → 1 %,
 * 500 → 6 %), la Kora doublant la perte et jamais le taux ; le gagnant garde sa mise.
 * Victoire simple, Kora, sans gagnant, fuyard, taux figé, 0 %, rejeu, échec et ROLLBACK.
 *
 * Mains (J1 = A, toujours meneur : il garde le contrôle à chaque tour, 5e tour automatique) :
 *   tour 1 ♥ (personne d'autre n'a de ♥), tour 2 ♣, tour 3 ⭐, tour 4 ♠, tour 5 ♥ (A seul).
 * Aucune main n'est une victoire instantanée (somme > 21, pas de brelan + paire…).
 */
jest.setTimeout(60_000);

const SIMPLE: CardId[][] = [
  ['COEUR-10', 'TREFLE-10', 'ETOILE-10', 'PIQUE-9', 'COEUR-8'],
  ['TREFLE-9', 'TREFLE-7', 'ETOILE-9', 'PIQUE-8', 'ETOILE-6'],
  ['TREFLE-8', 'TREFLE-6', 'ETOILE-8', 'PIQUE-7', 'ETOILE-5'],
  ['TREFLE-5', 'TREFLE-4', 'ETOILE-7', 'PIQUE-6', 'ETOILE-4'],
];
/** Même partie, mais A termine en remportant le dernier tour avec le 3♥ : Kora. */
const KORA: CardId[][] = [
  ['COEUR-10', 'TREFLE-10', 'ETOILE-10', 'PIQUE-9', 'COEUR-3'],
  ...SIMPLE.slice(1),
];

/** Partie à 2 : les deux premières mains. */
const TWO = SIMPLE.slice(0, 2);

let database: TestDatabase;
let ctx: GameApiTestContext;

/** Bus dont la diffusion peut tomber en panne (panne APRÈS la validation de la transaction). */
class FailingBus extends InMemoryGameEventHub {
  failing = false;
  override publishToGame(...args: Parameters<InMemoryGameEventHub['publishToGame']>) {
    if (this.failing) throw new Error('bus en panne');
    return super.publishToGame(...args);
  }
  override publishToPlayer(...args: Parameters<InMemoryGameEventHub['publishToPlayer']>) {
    if (this.failing) throw new Error('bus en panne');
    return super.publishToPlayer(...args);
  }
}

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(async () => {
  await ctx.stopTimers();
  await ctx.games.idle();
  await database.reset();
});

/** Une main par joueur ; un paquet par partie démarrée, dans l'ordre des démarrages. */
function app(...scripts: CardId[][][]) {
  appWith({}, ...scripts);
}

function appWith(extra: { bus?: FailingBus }, ...scripts: CardId[][][]) {
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: decksRandom(...scripts.map(deckForHands)),
    turnDurationMs: 60_000,
    decisionWindowMs: 60_000,
    stakePolicies: true, // validation D-073 + engagement et règlement D-074 / D-080
    ...extra,
  });
}

async function newPlayer(balance: number) {
  const session = await registerAndLogin(ctx.app);
  await database.sql.query(
    'INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())',
    [session.userId, balance],
  );
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

async function wallet(p: Player) {
  const { rows } = await database.sql.query<{ balance: string; reserved: string }>(
    'SELECT balance, reserved FROM wallets WHERE user_id = $1',
    [p.userId],
  );
  return { balance: Number(rows[0]!.balance), reserved: Number(rows[0]!.reserved) };
}

async function ledger() {
  const { rows } = await database.sql.query<{
    kind: string;
    amount: string;
    fee_bps: number;
    game_id: string;
  }>('SELECT kind, amount, fee_bps, game_id FROM platform_ledger ORDER BY created_at');
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

async function settlement(gameId: string) {
  const { rows } = await database.sql.query<Record<string, unknown>>(
    'SELECT * FROM game_settlements WHERE game_id = $1',
    [gameId],
  );
  return rows[0];
}

async function gameTransactions(gameId: string) {
  const { rows } = await database.sql.query<{ user_id: string; kind: string; tokens: string }>(
    `SELECT user_id, kind, tokens FROM wallet_transactions WHERE game_id = $1
     ORDER BY kind, user_id`,
    [gameId],
  );
  return rows.map((r) => ({ userId: r.user_id, kind: r.kind, tokens: Number(r.tokens) }));
}

const count = async (sql: string, params: unknown[] = []) =>
  Number((await database.sql.query<{ n: string }>(sql, params)).rows[0]!.n);

/** Table de `players.length` joueurs, mise `stake` ; démarrée par A. */
async function startTable(players: Player[], stake = 100) {
  const [A, ...others] = players;
  const created = await expectStatus(
    A!.api.post('/api/sessions', { maxPlayers: players.length, name: 'Table', stakeAmount: stake }),
    201,
  );
  const gameId = created.body.game.gameId as GameId;
  for (const p of others) await expectStatus(enterGame(p.api, database.sql, gameId), 200);
  await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);
  const game = (await ctx.games.findGame(gameId))!;
  // Main k → k-ième servi (deckForHands) : le script se joue dans l'ordre de distribution.
  const byId = new Map(players.map((p) => [p.id as string, p]));
  const seated = game.play!.dealOrder.map((id) => byId.get(id)!);
  return { gameId, seated };
}

const act = (p: Player, gameId: GameId, type: string, payload?: object) =>
  p.api.post(`/api/games/${gameId}/actions`, {
    commandId: randomUUID(),
    type,
    ...(payload && { payload }),
  });
const play = (p: Player, gameId: GameId, cardId: CardId) =>
  expectStatus(act(p, gameId, 'PLAY_CARD', { cardId }), 200);

/** Tours 1 à 4 joués par les joueurs eux-mêmes ; le 5e est automatique (D-035). */
async function playOut(gameId: GameId, seated: Player[], script: CardId[][]) {
  for (let trick = 0; trick < 4; trick++) {
    for (let k = 0; k < seated.length; k++) {
      await play(seated[k]!, gameId, script[k]![trick]!);
    }
  }
  const game = (await ctx.games.findGame(gameId))!;
  expect(game.status).toBe('finished');
  return game;
}

/** Termine une partie déjà entamée : tours `from` à 4, puis 5e tour automatique. */
async function playOutFrom(gameId: GameId, seated: Player[], script: CardId[][], from: number) {
  for (let trick = from; trick < 4; trick++) {
    for (let k = 0; k < seated.length; k++) await play(seated[k]!, gameId, script[k]![trick]!);
  }
  expect((await ctx.games.findGame(gameId))!.status).toBe('finished');
}

describe('Pendant la partie : aucun mouvement, solde et disponible inchangés (D-080)', () => {
  it('tours joués : solde, réservé et disponible intacts, aucune écriture', async () => {
    app(SIMPLE.slice(0, 3));
    const players = [await newPlayer(1_000), await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    const wallets = new PostgresWalletRepository(database.sql);

    // Deux tours joués : des cartes changent de main, le contrôle se décide, rien n'est réglé.
    for (let trick = 0; trick < 2; trick++) {
      for (let k = 0; k < seated.length; k++) await play(seated[k]!, gameId, SIMPLE[k]![trick]!);
    }
    const running = (await ctx.games.findGame(gameId))!;
    expect(running.status).toBe('in_progress');
    expect(running.result).toBeUndefined();

    for (const p of players) {
      // Ni débit, ni blocage visible : le joueur voit exactement son solde initial.
      expect(await wallet(p)).toEqual({ balance: 1_000, reserved: 0 });
      expect(await wallets.getBalances(p.userId as UserId)).toMatchObject({
        balance: 1_000,
        reserved: 0,
        available: 1_000,
      });
    }
    // Aucune perte, aucun gain, aucune commission dans les registres avant la fin.
    expect(await gameTransactions(gameId)).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect(await settlement(gameId)).toMatchObject({
      status: 'RESERVED',
      outcome: null,
      winner_id: null,
      commission_amount: null,
      net_gain: null,
      settled_at: null,
    });
    expect(
      await count(
        "SELECT count(*) AS n FROM wallet_reservations WHERE game_id = $1 AND status = 'ACTIVE'",
        [gameId],
      ),
    ).toBe(3);

    // Le règlement n'arrive qu'avec le résultat officiel (fin de la partie).
    await playOutFrom(gameId, seated, SIMPLE, 2);
    const s = (await settlement(gameId))!;
    expect(s).toMatchObject({ status: 'SETTLED', outcome: 'SIMPLE' });
    expect(await wallet(seated[0]!)).toEqual({ balance: 1_200 - 2, reserved: 0 }); // 2 × 100 − 1 %
    for (const p of seated.slice(1)) expect(await wallet(p)).toEqual({ balance: 900, reserved: 0 });
  });

  it('création, arrivée, démarrage, distribution et lecture : solde identique à chaque étape', async () => {
    app(TWO);
    const [A, B] = [await newPlayer(3_682), await newPlayer(7_710)];
    const snapshot = async () => [await wallet(A), await wallet(B)];
    const initial = [
      { balance: 3_682, reserved: 0 },
      { balance: 7_710, reserved: 0 },
    ];
    const created = await expectStatus(
      A.api.post('/api/sessions', { maxPlayers: 2, name: 'Table', stakeAmount: 500 }),
      201,
    );
    const gameId = created.body.game.gameId as GameId;
    expect(await snapshot()).toEqual(initial); // création
    await expectStatus(enterGame(B.api, database.sql, gameId), 200);
    expect(await snapshot()).toEqual(initial); // arrivée du second joueur
    await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
    const started = (await ctx.games.findGame(gameId))!;
    expect(started.status).toBe('in_progress');
    expect(Object.values(started.play!.hands).every((h) => h.length === 5)).toBe(true);
    expect(await snapshot()).toEqual(initial); // démarrage + distribution
    await expectStatus(A.api.get(`/api/games/${gameId}`), 200); // synchronisation
    expect(await snapshot()).toEqual(initial);
    expect(await gameTransactions(gameId)).toEqual([]);
    expect(await ledger()).toEqual([]);
  });
});

describe('Engagement : le perdant peut toujours payer, sans blocage visible', () => {
  it('pendant la partie, retrait et inscription ne peuvent pas entamer les 2 × mise engagés', async () => {
    app(TWO);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    const [A, B] = seated as [Player, Player];
    const id = B.userId as UserId;
    const wallets = new PostgresWalletRepository(database.sql);

    // Affichage : rien ne bouge. Contrôle de dépense (sous verrou) : 1 000 − 200 engagés.
    expect(await wallets.getBalances(id)).toMatchObject({ available: 1_000 });
    const locked = await database.sql.transaction((tx) => lockWalletBalances(tx, id, new Date()));
    expect(locked).toMatchObject({ balance: 1_000, reserved: 0, committed: 200, available: 800 });

    const withdrawal = (tokens: number) => ({
      id: randomUUID(),
      userId: id,
      kind: 'withdrawal' as const,
      status: 'pending' as const,
      tokens,
      idempotencyKey: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Retrait qui entamerait l'engagement : refusé.
    await expect(wallets.createPendingWithdrawal(withdrawal(801))).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
    // Inscription à un tournoi qui entamerait l'engagement : refusée, rien n'est réservé.
    await expect(
      database.sql.transaction((tx) =>
        reserveFunds(tx, {
          userId: id,
          tournamentId: randomUUID(),
          registrationId: randomUUID(),
          amount: 801,
          now: new Date(),
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    // Jusqu'à la limite : accepté.
    await wallets.createPendingWithdrawal(withdrawal(800));
    expect(await wallet(B)).toEqual({ balance: 200, reserved: 0 });

    // Le perdant paie sa perte au règlement, sans solde négatif.
    await playOut(gameId, seated, TWO);
    expect(await wallet(B)).toEqual({ balance: 100, reserved: 0 });
    expect(await wallet(A)).toEqual({ balance: 1_099, reserved: 0 });
    // Engagements clos : plus rien n'est déduit des dépenses.
    const after = await database.sql.transaction((tx) => lockWalletBalances(tx, id, new Date()));
    expect(after).toMatchObject({ committed: 0, available: 100 });
  });
});

describe('Exemple de référence (barème configuré : 401-500 → 6 %)', () => {
  /** Lamat crée la table (J1, meneur gagnant du script) ; Roly la rejoint. */
  async function referenceGame(script: CardId[][]) {
    app(script);
    const lamat = await newPlayer(7_710);
    const roly = await newPlayer(3_682);
    const { gameId, seated } = await startTable([lamat, roly], 500);
    expect(seated[0]!.id).toBe(lamat.id);
    // Pendant la partie : soldes initiaux.
    expect(await wallet(roly)).toEqual({ balance: 3_682, reserved: 0 });
    expect(await wallet(lamat)).toEqual({ balance: 7_710, reserved: 0 });
    expect(await settlement(gameId)).toMatchObject({ status: 'RESERVED', commission_bps: 600 });
    const finished = await playOut(gameId, seated, script);
    expect(finished.result?.winnerId).toBe(lamat.id);
    return { gameId, lamat, roly };
  }

  it('victoire simple de Lamat : Roly 3 182, Lamat 8 180, commission 30', async () => {
    const { gameId, lamat, roly } = await referenceGame(TWO);
    expect(await wallet(roly)).toEqual({ balance: 3_182, reserved: 0 });
    expect(await wallet(lamat)).toEqual({ balance: 8_180, reserved: 0 });
    expect(await ledger()).toEqual([
      { kind: 'GAME_COMMISSION', amount: 30, fee_bps: 600, game_id: gameId },
    ]);
    // Caisse unique, origine tracée (D-120) : une partie de Le Ter est une recette Fap-Fap.
    const sources = await database.sql.query<{ source: string }>(
      'SELECT source FROM platform_ledger WHERE game_id = $1',
      [gameId],
    );
    expect(sources.rows).toEqual([{ source: 'FAP_FAP' }]);
    const lines = await gameTransactions(gameId);
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        { userId: roly.userId, kind: 'game_stake', tokens: 500 },
        { userId: lamat.userId, kind: 'game_winnings', tokens: 470 },
      ]),
    );
  });

  it('Kora de Lamat : perte doublée, taux 6 % inchangé → Roly 2 682, Lamat 8 650, commission 60', async () => {
    const { gameId, lamat, roly } = await referenceGame(KORA.slice(0, 2));
    expect(await settlement(gameId)).toMatchObject({
      outcome: 'KORA',
      commission_bps: 600,
      applied_commission_bps: 600,
    });
    expect(await wallet(roly)).toEqual({ balance: 2_682, reserved: 0 });
    expect(await wallet(lamat)).toEqual({ balance: 8_650, reserved: 0 });
    expect(await ledger()).toEqual([
      { kind: 'GAME_COMMISSION', amount: 60, fee_bps: 600, game_id: gameId },
    ]);
    // Conservation : 3 682 + 7 710 = 2 682 + 8 650 + 60.
    const total = (await wallet(roly)).balance + (await wallet(lamat)).balance;
    expect(total + 60).toBe(3_682 + 7_710);
  });
});

describe('Victoire simple : 4 participants, mise 100, tranche à 1 %', () => {
  it('perdants −100, gagnant +297 (garde sa mise), plateforme +3', async () => {
    app(SIMPLE);
    const players = [
      await newPlayer(1_000),
      await newPlayer(1_000),
      await newPlayer(1_000),
      await newPlayer(1_000),
    ];
    const { gameId, seated } = await startTable(players);
    const [A] = seated;
    expect(A!.id).toBe(players[0]!.id);

    // Démarrage : rien de débité ni de bloqué dans le portefeuille, taux de la tranche figé (1 %).
    for (const p of players) expect(await wallet(p)).toEqual({ balance: 1_000, reserved: 0 });
    expect(await settlement(gameId)).toMatchObject({ status: 'RESERVED', commission_bps: 100 });

    const finished = await playOut(gameId, seated, SIMPLE);
    expect(finished.result?.winnerId).toBe(A!.id);

    expect(await settlement(gameId)).toMatchObject({
      status: 'SETTLED',
      outcome: 'SIMPLE',
      winner_id: A!.id,
      participants: 4,
      commission_bps: 100,
      applied_commission_bps: 100,
    });
    const s = (await settlement(gameId))!;
    expect([s.unit_amount, s.gross_amount, s.commission_amount, s.net_gain].map(Number)).toEqual([
      100, 300, 3, 297,
    ]);
    expect(await wallet(A!)).toEqual({ balance: 1_297, reserved: 0 });
    for (const p of seated.slice(1)) expect(await wallet(p)).toEqual({ balance: 900, reserved: 0 });
    expect(await ledger()).toEqual([
      { kind: 'GAME_COMMISSION', amount: 3, fee_bps: 100, game_id: gameId },
    ]);

    // Écritures : une mise consommée par PERDANT, un gain : Σ débits = net + commission.
    const lines = await gameTransactions(gameId);
    expect(lines.filter((l) => l.kind === 'game_stake').map((l) => l.tokens)).toEqual([
      100, 100, 100,
    ]);
    expect(lines.some((l) => l.kind === 'game_stake' && l.userId === A!.userId)).toBe(false);
    expect(lines.filter((l) => l.kind === 'game_winnings')).toEqual([
      { userId: A!.userId, kind: 'game_winnings', tokens: 297 },
    ]);
    // Conservation : aucun jeton créé ni détruit (joueurs + plateforme = 4 000).
    const total = (await Promise.all(players.map(wallet))).reduce((t, w) => t + w.balance, 0);
    expect(total + 3).toBe(4_000);
    // Engagements : perdants capturés pour 100, gagnant libéré.
    expect(
      await count(
        "SELECT count(*) AS n FROM wallet_reservations WHERE game_id = $1 AND status = 'CAPTURED' AND captured_amount = 100",
        [gameId],
      ),
    ).toBe(3);
    expect(
      await count(
        "SELECT count(*) AS n FROM wallet_reservations WHERE game_id = $1 AND status = 'RELEASED' AND wallet_id = $2",
        [gameId, A!.userId],
      ),
    ).toBe(1);
  });
});

describe('Victoire par Kora : le gagnant remporte le dernier tour avec un 3', () => {
  it('perdants −200, taux inchangé (1 %), gagnant +594, plateforme +6 ; solde exactement 2 × mise', async () => {
    app(KORA);
    // Le 4e joueur a EXACTEMENT 2 × mise : il peut jouer, et perdre au plus 200.
    const players = [
      await newPlayer(1_000),
      await newPlayer(1_000),
      await newPlayer(1_000),
      await newPlayer(200),
    ];
    const { gameId, seated } = await startTable(players);
    const finished = await playOut(gameId, seated, KORA);
    const last = finished.play!.completedTricks.at(-1)!;
    expect(last.number).toBe(5);
    expect(last.plays.find((p) => p.playerId === finished.result!.winnerId)!.cardId).toBe(
      'COEUR-3',
    );

    const s = (await settlement(gameId))!;
    expect(s).toMatchObject({
      status: 'SETTLED',
      outcome: 'KORA',
      participants: 4,
      commission_bps: 100,
      applied_commission_bps: 100,
    });
    expect([s.unit_amount, s.gross_amount, s.commission_amount, s.net_gain].map(Number)).toEqual([
      200, 600, 6, 594,
    ]);
    expect(await wallet(players[0]!)).toEqual({ balance: 1_594, reserved: 0 });
    expect(await wallet(players[1]!)).toEqual({ balance: 800, reserved: 0 });
    expect(await wallet(players[2]!)).toEqual({ balance: 800, reserved: 0 });
    expect(await wallet(players[3]!)).toEqual({ balance: 0, reserved: 0 });
    expect(await ledger()).toEqual([
      { kind: 'GAME_COMMISSION', amount: 6, fee_bps: 100, game_id: gameId },
    ]);
    const total = (await Promise.all(players.map(wallet))).reduce((t, w) => t + w.balance, 0);
    expect(total + 6).toBe(3_200);
  });
});

describe('Partie sans gagnant (arrêt administratif)', () => {
  it('commission 0, aucune mise consommée, aucun gain, réservations libérées', async () => {
    app(SIMPLE);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId } = await startTable(players);
    await ctx.games.finishGame(gameId);

    expect(await settlement(gameId)).toMatchObject({
      status: 'VOID',
      outcome: 'NO_WINNER',
      winner_id: null,
      void_reason: 'ADMIN_STOP',
    });
    expect(Number((await settlement(gameId))!.commission_amount)).toBe(0);
    for (const p of players) expect(await wallet(p)).toEqual({ balance: 1_000, reserved: 0 });
    expect(await gameTransactions(gameId)).toEqual([]);
    expect(await ledger()).toEqual([]);
  });
});

describe('Fuyard (R-05 non tranché)', () => {
  it('le fuyard n’est ni débité ni compté : N = 2, brut 100, commission 1, net 99', async () => {
    app(SIMPLE.slice(0, 3));
    const players = [await newPlayer(1_000), await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    const [A, B, C] = seated as [Player, Player, Player];
    // Tour 1 : A et B jouent, C fuit avant sa première carte.
    await play(A, gameId, SIMPLE[0]![0]!);
    await play(B, gameId, SIMPLE[1]![0]!);
    await expectStatus(act(C, gameId, 'FLEE'), 200);
    for (let trick = 1; trick < 4; trick++) {
      await play(A, gameId, SIMPLE[0]![trick]!);
      await play(B, gameId, SIMPLE[1]![trick]!);
    }
    expect((await ctx.games.findGame(gameId))!.status).toBe('finished');

    const s = (await settlement(gameId))!;
    expect([s.participants, s.gross_amount, s.commission_amount, s.net_gain].map(Number)).toEqual([
      2, 100, 1, 99,
    ]);
    expect(await wallet(A)).toEqual({ balance: 1_099, reserved: 0 });
    expect(await wallet(B)).toEqual({ balance: 900, reserved: 0 });
    expect(await wallet(C)).toEqual({ balance: 1_000, reserved: 0 });
  });

  it('partie à 2 (R-30, D-086) : le fuyard perd sa mise, l’autre gagne (simple), un seul règlement', async () => {
    app(TWO);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    const [A, B] = seated as [Player, Player];
    // B se couche au tour 1, avant sa première carte ; deux envois simultanés.
    const [first, second] = await Promise.all([act(B, gameId, 'FLEE'), act(B, gameId, 'FLEE')]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const game = (await ctx.games.findGame(gameId))!;
    expect(game).toMatchObject({ status: 'finished', endReason: 'OPPONENT_FLED' });
    expect(game.result).toMatchObject({ winnerId: A.id, victoryType: 'SIMPLE' });
    const s = (await settlement(gameId))!;
    expect(s.outcome).toBe('SIMPLE');
    expect([s.participants, s.gross_amount, s.commission_amount, s.net_gain].map(Number)).toEqual([
      2, 100, 1, 99,
    ]);
    expect(await wallet(A)).toEqual({ balance: 1_099, reserved: 0 });
    expect(await wallet(B)).toEqual({ balance: 900, reserved: 0 });
    expect((await ledger()).filter((l) => l.game_id === gameId)).toHaveLength(1);
  });
});

describe('Main spéciale déclarée (victoire instantanée, D-035) : règlement unique', () => {
  /** Règles OFFICIELLES (analyse des mains) : A, premier servi, a 5 cartes ♥ ; B rien. */
  const INSTANT: CardId[][] = [
    ['COEUR-3', 'COEUR-6', 'COEUR-7', 'COEUR-8', 'COEUR-9'],
    ['TREFLE-9', 'ETOILE-10', 'PIQUE-9', 'ETOILE-6', 'TREFLE-7'],
  ];

  it('victoire simple : B −100, A +99, commission 1 une seule fois malgré deux déclarations', async () => {
    ctx = createGameApiTestApp(database.sql, {
      random: decksRandom(deckForHands(INSTANT)),
      turnDurationMs: 60_000,
      decisionWindowMs: 60_000,
      stakePolicies: true,
    });
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    const [A, B] = seated as [Player, Player];
    // Le serveur seul décide qui peut déclarer : B (main ordinaire) est refusé.
    expect((await act(B, gameId, 'DECLARE_WIN')).body.code).toBe('NOT_A_WINNING_HAND');

    const [first, second] = await Promise.all([
      act(A, gameId, 'DECLARE_WIN'),
      act(A, gameId, 'DECLARE_WIN'),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    // Fin de partie synchronisée : B lit le résultat officiel.
    const viewB = (await expectStatus(B.api.get(`/api/games/${gameId}`), 200)).body.game;
    expect(viewB).toMatchObject({ status: 'finished', endReason: 'INSTANT_WIN' });
    expect(viewB.result).toMatchObject({ winnerId: A.id, victoryType: 'SIMPLE' });

    const s = (await settlement(gameId))!;
    expect([s.participants, s.gross_amount, s.commission_amount, s.net_gain].map(Number)).toEqual([
      2, 100, 1, 99,
    ]);
    expect(await wallet(A)).toEqual({ balance: 1_099, reserved: 0 });
    expect(await wallet(B)).toEqual({ balance: 900, reserved: 0 });
    expect((await ledger()).filter((l) => l.game_id === gameId)).toHaveLength(1);
    const settled = 'SELECT count(*) AS n FROM game_settlements WHERE game_id = $1';
    expect(await count(settled, [gameId])).toBe(1);
  });
});

describe('Barème configuré dans l’administration', () => {
  it('figée au démarrage : un changement pendant la partie ne s’applique qu’aux suivantes', async () => {
    app(TWO);
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);

    const flat10 = [{ minStake: 1, maxStake: null, percent: 10 }];
    const changed = await expectStatus(
      admin.patch('/api/admin/settings/game-commission', { tiers: flat10 }),
      200,
    );
    expect(changed.body).toMatchObject({ tiers: flat10, changed: true });
    expect(
      await count(
        "SELECT count(*) AS n FROM admin_audit_log WHERE action = 'GAME_COMMISSION_UPDATED'",
      ),
    ).toBe(1);

    await playOut(gameId, seated, SIMPLE);
    // Mise du perdant 100 au taux FIGÉ de 1 % → 1 (et non 10 à 10 %).
    expect(Number((await settlement(gameId))!.commission_amount)).toBe(1);
    expect((await ledger())[0]).toMatchObject({ amount: 1, fee_bps: 100 });
    // Le barème réellement enregistré est relu par l'administration.
    const read = await expectStatus(admin.get('/api/admin/settings/game-commission'), 200);
    expect(read.body.tiers).toEqual(flat10);
    // Aucun recalcul rétroactif : la partie réglée garde ses montants.
    expect(Number((await settlement(gameId))!.commission_bps)).toBe(100);
  });

  it('taux différents selon la tranche et changement ENTRE deux parties', async () => {
    app(TWO, TWO);
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    const tiers = [
      { minStake: 1, maxStake: 99, percent: 0.5 },
      { minStake: 100, maxStake: null, percent: 12.5 },
    ];
    await expectStatus(admin.patch('/api/admin/settings/game-commission', { tiers }), 200);
    const first = await startTable([await newPlayer(1_000), await newPlayer(1_000)], 99);
    await playOut(first.gameId, first.seated, TWO);
    // 99 × 0,5 % = 0,495 → 0 : commission nulle, aucune ligne au compte de la plateforme.
    expect(await settlement(first.gameId)).toMatchObject({ commission_bps: 50 });
    expect(Number((await settlement(first.gameId))!.commission_amount)).toBe(0);

    await expectStatus(
      admin.patch('/api/admin/settings/game-commission', {
        tiers: [{ minStake: 1, maxStake: null, percent: 33.33 }],
      }),
      200,
    );
    const second = await startTable([await newPlayer(1_000), await newPlayer(1_000)], 101);
    await playOut(second.gameId, second.seated, TWO);
    // 101 × 33,33 % = 33,66 → 33 : arrondi à l'entier inférieur, en faveur du joueur.
    expect(await settlement(second.gameId)).toMatchObject({ commission_bps: 3_333 });
    expect(await wallet(second.seated[0]!)).toEqual({ balance: 1_000 + 101 - 33, reserved: 0 });
    expect(await ledger()).toEqual([
      { kind: 'GAME_COMMISSION', amount: 33, fee_bps: 3_333, game_id: second.gameId },
    ]);
  });

  it('taux maximal (100 %) : la commission absorbe la perte, gain net 0, aucun solde négatif', async () => {
    app(TWO);
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    await expectStatus(
      admin.patch('/api/admin/settings/game-commission', {
        tiers: [{ minStake: 1, maxStake: null, percent: 100 }],
      }),
      200,
    );
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    await playOut(gameId, seated, TWO);
    expect(await wallet(seated[0]!)).toEqual({ balance: 1_000, reserved: 0 });
    expect(await wallet(seated[1]!)).toEqual({ balance: 900, reserved: 0 });
    expect(await ledger()).toEqual([
      { kind: 'GAME_COMMISSION', amount: 100, fee_bps: 10_000, game_id: gameId },
    ]);
  });

  it('0 % : aucun prélèvement, le gagnant reçoit la mise du perdant', async () => {
    app(TWO);
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    await expectStatus(
      admin.patch('/api/admin/settings/game-commission', {
        tiers: [{ minStake: 1, maxStake: null, percent: 0 }],
      }),
      200,
    );
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    await playOut(gameId, seated, SIMPLE);
    expect(await ledger()).toEqual([]);
    expect(await wallet(seated[0]!)).toEqual({ balance: 1_100, reserved: 0 });
    expect(await wallet(seated[1]!)).toEqual({ balance: 900, reserved: 0 });
  });

  it('barèmes invalides refusés (400), barème initial, joueur ordinaire refusé (403)', async () => {
    app(SIMPLE);
    const admin = asAdmin(ctx.app, (await createAdmin(ctx.app, database.sql)).accessToken);
    const initial = (await expectStatus(admin.get('/api/admin/settings/game-commission'), 200))
      .body;
    expect(initial).toMatchObject({
      updatedAt: null,
      koraLossMultiplier: 2,
      limits: { min: 0, max: 100 },
    });
    expect(initial.tiers).toHaveLength(9);
    expect(initial.tiers[1]).toEqual({ minStake: 6, maxStake: 100, percent: 1 });
    expect(initial.tiers.at(-1)).toEqual({ minStake: 1000, maxStake: null, percent: 10 });
    for (const tiers of [
      [],
      null,
      '5',
      [
        { minStake: 1, maxStake: 99, percent: 1 },
        { minStake: 101, maxStake: null, percent: 2 },
      ],
      [{ minStake: 1, maxStake: null, percent: 100.01 }],
      [{ minStake: 1, maxStake: null, percent: -1 }],
      [{ minStake: 1, maxStake: null, percent: 2.345 }],
      [{ minStake: 1, maxStake: 100, percent: 1 }],
    ]) {
      const res = await admin.patch('/api/admin/settings/game-commission', { tiers });
      expect(res.status).toBe(400);
      expect(res.body.fields.tiers).toBeDefined();
    }
    const unknown = await admin.patch('/api/admin/settings/game-commission', { percent: 5 });
    expect(unknown.status).toBe(400);
    const player = await newPlayer(0);
    const refused = await player.api.get('/api/admin/settings/game-commission');
    expect([401, 403]).toContain(refused.status);
    expect(await count('SELECT count(*) AS n FROM system_settings')).toBe(0);
  });
});

describe('Idempotence, concurrence et atomicité', () => {
  it('fin de partie répétée ou rejouée en parallèle : un seul règlement', async () => {
    app(TWO);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    const finished = await playOut(gameId, seated, SIMPLE);
    const before = await Promise.all(players.map(wallet));
    const ledgerBefore = await ledger();

    // Événement de fin reçu plusieurs fois (reprise, autre instance), y compris en même temps.
    const replay = new PostgresGameStakeLedger();
    await Promise.all(
      [1, 2, 3].map(() =>
        database.sql.transaction((tx) => replay.afterGameWrite(tx, finished, 'in_progress')),
      ),
    );
    // Commande de fin rejouée : refusée ou ignorée par GameService, jamais réglée deux fois.
    await ctx.games.finishGame(gameId);

    expect(await Promise.all(players.map(wallet))).toEqual(before);
    expect(await ledger()).toEqual(ledgerBefore);
    expect((await gameTransactions(gameId)).length).toBe(2); // 1 mise (perdant) + 1 gain
  });

  it('échec d’une écriture du règlement : ROLLBACK intégral (partie non terminée, soldes intacts)', async () => {
    app(SIMPLE);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId } = await startTable(players);
    const running = (await ctx.games.findGame(gameId))!;
    const ended: Game = {
      ...structuredClone(running),
      version: running.version + 1,
      status: 'finished',
      finishedAt: new Date(),
      endReason: 'INSTANT_WIN',
      result: {
        winnerId: players[0]!.id,
        method: 'INSTANT_WIN',
        victoryType: 'SIMPLE',
        remainingOpponentIds: [players[1]!.id],
        fledPlayerIds: [],
      },
    };
    const real = new PostgresGameStakeLedger();
    const failing: GameStakeLedger = {
      async afterGameWrite(tx, game, previous) {
        await real.afterGameWrite(tx, game, previous);
        throw new Error('panne simulée après le règlement');
      },
    };
    await expect(
      database.sql.transaction((tx) => updateGameRows(tx, ended, running.version, failing)),
    ).rejects.toThrow('panne simulée');

    expect((await ctx.games.findGame(gameId))!.status).toBe('in_progress');
    expect(await settlement(gameId)).toMatchObject({ status: 'RESERVED' });
    for (const p of players) expect(await wallet(p)).toEqual({ balance: 1_000, reserved: 0 });
    expect(
      await count(
        "SELECT count(*) AS n FROM wallet_reservations WHERE game_id = $1 AND status = 'ACTIVE'",
        [gameId],
      ),
    ).toBe(2);
    expect(await gameTransactions(gameId)).toEqual([]);
    expect(await ledger()).toEqual([]);

    // La même écriture, sans panne : réglée une fois, correctement.
    await database.sql.transaction((tx) => updateGameRows(tx, ended, running.version, real));
    expect(await wallet(players[0]!)).toEqual({ balance: 1_099, reserved: 0 });
    expect(await wallet(players[1]!)).toEqual({ balance: 900, reserved: 0 });
  });

  it('disponible devenu insuffisant avant le démarrage : démarrage refusé, rien de réservé', async () => {
    app(SIMPLE);
    const [A, B] = [await newPlayer(1_000), await newPlayer(200)];
    const created = await expectStatus(
      A.api.post('/api/sessions', { maxPlayers: 2, name: 'Table', stakeAmount: 100 }),
      201,
    );
    const gameId = created.body.game.gameId as GameId;
    await expectStatus(enterGame(B.api, database.sql, gameId), 200);
    // B engage une partie de son solde ailleurs (ex. retrait) après son arrivée à la table.
    await database.sql.query('UPDATE wallets SET balance = 150 WHERE user_id = $1', [B.userId]);

    const refused = await A.api.post(`/api/games/${gameId}/start`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('STAKE_NOT_COVERED');
    expect((await ctx.games.findGame(gameId))!.status).toBe('waiting');
    expect(await settlement(gameId)).toBeUndefined();
    expect(await count('SELECT count(*) AS n FROM wallet_reservations')).toBe(0);
    expect(await wallet(A)).toEqual({ balance: 1_000, reserved: 0 });
  });

  it('panne de diffusion APRÈS la validation : règlement durable, unique, relu par la vue', async () => {
    const bus = new FailingBus();
    appWith({ bus }, TWO);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    for (let trick = 0; trick < 3; trick++) {
      for (let k = 0; k < 2; k++) await play(seated[k]!, gameId, TWO[k]![trick]!);
    }
    bus.failing = true; // les dernières commandes sont enregistrées, leur diffusion échoue
    await play(seated[0]!, gameId, TWO[0]![3]!);
    await play(seated[1]!, gameId, TWO[1]![3]!);
    bus.failing = false;
    expect((await ctx.games.findGame(gameId))!.status).toBe('finished');
    expect(await settlement(gameId)).toMatchObject({ status: 'SETTLED' });
    // Reprise du client par la vue : bilan lu dans l'état enregistré, aucun nouveau règlement.
    const view = await expectStatus(seated[1]!.api.get(`/api/games/${gameId}`), 200);
    expect(view.body.game.mySettlement).toEqual({ delta: -100, account: 'WALLET' });
    await ctx.games.finishGame(gameId);
    expect((await gameTransactions(gameId)).length).toBe(2);
    expect(await ledger()).toHaveLength(1);
    expect(await wallet(seated[0]!)).toEqual({ balance: 1_099, reserved: 0 });
  });

  it('migration 0035 : une partie démarrée sous l’ancien séquestre est convertie sans mouvement', async () => {
    app(TWO);
    const players = [await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    // État laissé par l'ancien code (D-074) : 2 × mise comptés dans `wallets.reserved`.
    for (const p of players) {
      await database.sql.query('UPDATE wallets SET reserved = reserved + 200 WHERE user_id = $1', [
        p.userId,
      ]);
    }
    const file = await readFile(
      join(__dirname, '../../../migrations/0035_game_stake_commitments.sql'),
      'utf8',
    );
    await database.sql.query(file.slice(0, file.indexOf('CREATE INDEX')));
    for (const p of players) expect(await wallet(p)).toEqual({ balance: 1_000, reserved: 0 });
    await playOut(gameId, seated, TWO);
    expect(await wallet(seated[0]!)).toEqual({ balance: 1_099, reserved: 0 });
    expect(await wallet(seated[1]!)).toEqual({ balance: 900, reserved: 0 });
  });

  it('plusieurs parties simultanées : chacune réglée sur ses propres joueurs', async () => {
    app(TWO, TWO);
    const t1 = [await newPlayer(1_000), await newPlayer(1_000)];
    const t2 = [await newPlayer(500), await newPlayer(500)];
    const g1 = await startTable(t1, 100);
    const g2 = await startTable(t2, 200);
    await Promise.all([
      playOut(g1.gameId, g1.seated, SIMPLE),
      playOut(g2.gameId, g2.seated, SIMPLE),
    ]);
    expect(await wallet(g1.seated[0]!)).toEqual({ balance: 1_099, reserved: 0 }); // 100 − 1 % = 99
    expect(await wallet(g2.seated[0]!)).toEqual({ balance: 696, reserved: 0 }); // 200 − 2 % = 196
    expect(await wallet(g2.seated[1]!)).toEqual({ balance: 300, reserved: 0 });
    expect((await ledger()).map((l) => [l.amount, l.fee_bps]).sort()).toEqual([
      [1, 100],
      [4, 200],
    ]);
  });
});

describe('Bilan du joueur dans sa vue (panneau de fin de partie)', () => {
  const view = async (p: Player, gameId: GameId) =>
    (await expectStatus(p.api.get(`/api/games/${gameId}`), 200)).body.game;

  it('chaque joueur ne lit que SA variation réglée : gagnant +net, perdant −mise, fuyard 0', async () => {
    app(SIMPLE.slice(0, 3));
    const players = [await newPlayer(1_000), await newPlayer(1_000), await newPlayer(1_000)];
    const { gameId, seated } = await startTable(players);
    const [A, B, C] = seated as [Player, Player, Player];
    await play(A, gameId, SIMPLE[0]![0]!);
    // Partie en cours : aucun bilan.
    expect((await view(A, gameId)).mySettlement).toBeUndefined();
    await play(B, gameId, SIMPLE[1]![0]!);
    await expectStatus(act(C, gameId, 'FLEE'), 200);
    for (let trick = 1; trick < 4; trick++) {
      await play(A, gameId, SIMPLE[0]![trick]!);
      await play(B, gameId, SIMPLE[1]![trick]!);
    }

    expect((await view(A, gameId)).mySettlement).toEqual({ delta: 99, account: 'WALLET' });
    expect((await view(B, gameId)).mySettlement).toEqual({ delta: -100, account: 'WALLET' });
    expect((await view(C, gameId)).mySettlement).toEqual({ delta: 0, account: 'WALLET' });
  });

  it('parties simultanées : le bilan vient de la partie demandée seulement', async () => {
    app(TWO, TWO);
    const [A, B, C, D] = [
      await newPlayer(1_000),
      await newPlayer(1_000),
      await newPlayer(1_000),
      await newPlayer(1_000),
    ];
    const first = await startTable([A!, B!], 100);
    const second = await startTable([C!, D!], 50);
    await playOut(first.gameId, first.seated, TWO);
    await playOut(second.gameId, second.seated, TWO);

    expect((await view(first.seated[0]!, first.gameId)).mySettlement).toEqual({ delta: 99, account: 'WALLET' });
    expect((await view(first.seated[1]!, first.gameId)).mySettlement).toEqual({ delta: -100, account: 'WALLET' });
    expect((await view(second.seated[0]!, second.gameId)).mySettlement).toEqual({ delta: 50, account: 'WALLET' });
    expect((await view(second.seated[1]!, second.gameId)).mySettlement).toEqual({ delta: -50, account: 'WALLET' });
  });
});
