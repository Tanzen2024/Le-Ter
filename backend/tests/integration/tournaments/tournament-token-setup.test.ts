import request from 'supertest';

import type { PlayerId } from '../../../src/domain/game/game-id';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { adminLogin } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  createTournamentTestStack,
  fillWith,
  finishedCopy,
  HOUR,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Jetons de départ et mise par partie (D-071) : calculés par le serveur SEUL depuis le prix
 * d'entrée et les coefficients des paramètres plateforme ; ils suivent les coefficients tant
 * que le tournoi n'est pas publié, puis sont figés à l'approbation. Aucune saisie possible.
 */
jest.setTimeout(90_000);

let database: TestDatabase;
let stack: TournamentTestStack;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  stack = createTournamentTestStack(database.sql, new TestClock());
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

async function user(role: 'user' | 'admin' = 'user') {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  if (role === 'admin')
    await database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [id]);
  const token =
    role === 'admin'
      ? (await adminLogin(stack.app, session.email, session.password, id)).accessToken
      : session.accessToken;
  const auth = `Bearer ${token}`;
  return {
    id,
    get: (path: string) => request(stack.app).get(path).set('Authorization', auth),
    post: (path: string, body: object = {}) =>
      request(stack.app).post(path).set('Authorization', auth).send(body),
    patch: (path: string, body: object) =>
      request(stack.app).patch(path).set('Authorization', auth).send(body),
  };
}
type Client = Awaited<ReturnType<typeof user>>;

function body(extra: Record<string, unknown> = {}) {
  const startsAt = new Date(stack.clock.now().getTime() + 3 * HOUR);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 2 * HOUR).toISOString(),
    entryFee: 1000,
    minimumPlayers: 20,
    maximumPlayers: 50,
    prizeRules: [{ rank: 1, percent: 100 }],
    ...extra,
  };
}

/** Proposition d'un joueur soumise à l'approbation (PENDING_APPROVAL). */
async function pendingProposal(player: Client, extra = {}) {
  const created = await player.post('/api/tournaments', body(extra)).expect(201);
  const id = created.body.tournament.tournamentId as string;
  await player.post(`/api/tournaments/${id}/submit`).expect(200);
  return id;
}

const detail = async (admin: Client, id: string) =>
  (await admin.get(`/api/admin/tournaments/${id}`).expect(200)).body.tournament;

describe('paramètres plateforme', () => {
  it('valeurs initiales : commission 15, coefficients 10 et 0,5, poids 60 / 40', async () => {
    const admin = await user('admin');
    const { settings } = (await admin.get('/api/admin/tournaments/settings').expect(200)).body;
    expect(settings).toEqual({
      platformFeePercent: 15,
      initialTokensCoefficient: 10,
      stakePerGameCoefficient: 0.5,
      maximumPendingTournamentsPerPlayer: 1,
      tournamentTransitionMinutes: 0,
      rankingTokensWeightPercent: 60,
      rankingGamesWeightPercent: 40,
      tournamentMinimumPlayers: 20,
      tournamentMaximumPlayers: null,
      tournamentMinimumDurationMinutes: 45,
      tournamentMaximumDurationMinutes: 120,
      tournamentMinimumEntryFee: 500,
    });
  });

  it('réglages déjà enregistrés conservés ; anciennes valeurs fixes jamais lues comme coefficients', async () => {
    // Installation existante : réglages enregistrés avant D-071 (dont les anciennes clés fixes).
    const saved: [string, number][] = [
      ['tournament_platform_fee_percent', 10],
      ['initial_tournament_tokens', 1000],
      ['default_tournament_stake', 100],
      ['maximum_pending_tournaments_per_player', 3],
      ['tournament_transition_minutes', 15],
      ['tournament_ranking_tokens_weight_percent', 50],
      ['tournament_ranking_games_weight_percent', 50],
    ];
    for (const [key, value] of saved) {
      await database.sql.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())`,
        [key, JSON.stringify(value)],
      );
    }
    const admin = await user('admin');
    const read = async () =>
      (await admin.get('/api/admin/tournaments/settings').expect(200)).body.settings;
    expect(await read()).toEqual({
      platformFeePercent: 10,
      initialTokensCoefficient: 10, // jamais enregistré : valeur initiale, pas 1000
      stakePerGameCoefficient: 0.5,
      maximumPendingTournamentsPerPlayer: 3,
      tournamentTransitionMinutes: 15,
      rankingTokensWeightPercent: 50,
      rankingGamesWeightPercent: 50,
      tournamentMinimumPlayers: 20,
      tournamentMaximumPlayers: null,
      tournamentMinimumDurationMinutes: 45,
      tournamentMaximumDurationMinutes: 120,
      tournamentMinimumEntryFee: 500,
    });
    await admin
      .patch('/api/admin/tournaments/settings', { stakePerGameCoefficient: 0.25 })
      .expect(200);
    expect(await read()).toMatchObject({
      platformFeePercent: 10,
      stakePerGameCoefficient: 0.25,
      rankingTokensWeightPercent: 50,
      maximumPendingTournamentsPerPlayer: 3,
    });
  });

  it('coefficients décimaux acceptés (0,5 ; 2,35) ; invalides refusés sans rien changer', async () => {
    const admin = await user('admin');
    const ok = await admin
      .patch('/api/admin/tournaments/settings', {
        initialTokensCoefficient: 2.35,
        stakePerGameCoefficient: 0.5,
      })
      .expect(200);
    expect(ok.body.settings).toMatchObject({
      initialTokensCoefficient: 2.35,
      stakePerGameCoefficient: 0.5,
    });
    const invalid: Record<string, unknown>[] = [
      { initialTokensCoefficient: 0 },
      { initialTokensCoefficient: -1 },
      { stakePerGameCoefficient: 0.001 }, // plus de 2 décimales
      { stakePerGameCoefficient: '0,5' }, // nombre JSON attendu
      { initialTokensCoefficient: 2001 },
      { stakePerGameCoefficient: 1.18 }, // 2 × mise > jetons (D-063)
      { initialTokensCoefficient: 0.5 }, // idem, avec la mise 0,5 enregistrée
      { startingChips: 10 }, // clé inconnue
    ];
    for (const patch of invalid) {
      const res = await admin.patch('/api/admin/tournaments/settings', patch);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fields ?? {}).length).toBeGreaterThan(0);
    }
    const { settings } = (await admin.get('/api/admin/tournaments/settings').expect(200)).body;
    expect(settings).toMatchObject({
      initialTokensCoefficient: 2.35,
      stakePerGameCoefficient: 0.5,
    });
  });
});

describe('calcul par le serveur', () => {
  it('prix 1 000 → 10 000 jetons et mise 500 ; prix 2 000 → 20 000 et 1 000', async () => {
    const [admin, ana, ben] = [await user('admin'), await user(), await user()];
    const a = await pendingProposal(ana);
    expect(await detail(admin, a)).toMatchObject({
      status: 'PENDING_APPROVAL',
      entryFee: 1000,
      initialTournamentTokens: 10_000,
      stakePerGame: 500,
      tokenCoefficients: { initialTokensCoefficient: 10, stakePerGameCoefficient: 0.5 },
    });
    const b = await pendingProposal(ben, {
      startsAt: new Date(stack.clock.now().getTime() + 6 * HOUR).toISOString(),
      endsAt: new Date(stack.clock.now().getTime() + 8 * HOUR).toISOString(),
      entryFee: 2000,
    });
    expect(await detail(admin, b)).toMatchObject({
      entryFee: 2000,
      initialTournamentTokens: 20_000,
      stakePerGame: 1000,
    });
  });

  it('prix d’entrée modifié avant approbation : recalculé ; prix sous 500 refusé', async () => {
    const [admin, ana] = [await user('admin'), await user()];
    const id = await pendingProposal(ana);
    await ana.patch(`/api/tournaments/${id}`, { entryFee: 2001 }).expect(200);
    expect(await detail(admin, id)).toMatchObject({
      initialTournamentTokens: 20_010,
      stakePerGame: 1000, // 1000,5 arrondi à l'entier inférieur
    });
    for (const entryFee of [0, 499, 100_001, 750.5]) {
      const res = await admin.patch(`/api/admin/tournaments/${id}`, { entryFee });
      expect(res.status).toBe(400);
      expect(res.body.fields).toHaveProperty('entryFee');
    }
    expect((await ana.post('/api/tournaments', body({ entryFee: 499 }))).status).toBe(400);
    await admin.patch(`/api/admin/tournaments/${id}`, { entryFee: 500 }).expect(200);
    expect(await detail(admin, id)).toMatchObject({
      initialTournamentTokens: 5000,
      stakePerGame: 250,
    });
  });

  it('valeurs falsifiées refusées partout (création, proposition, administration)', async () => {
    const [admin, ana] = [await user('admin'), await user()];
    const id = await pendingProposal(ana);
    const forged = [
      { initialTournamentTokens: 99_000 },
      { stakePerGame: 1 },
      { initialTournamentTokens: 3000, stakePerGame: 150 },
    ];
    for (const patch of forged) {
      for (const res of [
        await admin.patch(`/api/admin/tournaments/${id}`, patch),
        await ana.patch(`/api/tournaments/${id}`, patch),
        await ana.post('/api/tournaments', body(patch)),
        await admin.post('/api/admin/tournaments', body(patch)),
      ]) {
        expect(res.status).toBe(400);
        expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(Object.keys(patch)));
      }
    }
    await admin.post(`/api/admin/tournaments/${id}/approve`).expect(200);
    expect(await detail(admin, id)).toMatchObject({
      initialTournamentTokens: 10_000,
      stakePerGame: 500,
    });
  });
});

describe('figés à la publication', () => {
  it('proposition : suit les coefficients jusqu’à l’approbation, puis ne change plus', async () => {
    const [admin, ana] = [await user('admin'), await user()];
    const id = await pendingProposal(ana);
    await admin
      .patch('/api/admin/tournaments/settings', {
        initialTokensCoefficient: 8,
        stakePerGameCoefficient: 0.4,
      })
      .expect(200);
    expect(await detail(admin, id)).toMatchObject({
      initialTournamentTokens: 8000,
      stakePerGame: 400,
    });
    await admin.post(`/api/admin/tournaments/${id}/approve`).expect(200);
    await admin
      .patch('/api/admin/tournaments/settings', {
        initialTokensCoefficient: 20,
        stakePerGameCoefficient: 1,
      })
      .expect(200);
    const t = await detail(admin, id);
    expect(t).toMatchObject({ initialTournamentTokens: 8000, stakePerGame: 400 });
    expect(t).not.toHaveProperty('tokenCoefficients');
    // Modification sans changer le prix : les valeurs figées restent.
    await admin
      .patch(`/api/admin/tournaments/${id}`, { minimumPlayers: 25, entryFee: 1000 })
      .expect(200);
    expect(await detail(admin, id)).toMatchObject({
      initialTournamentTokens: 8000,
      stakePerGame: 400,
    });
  });

  it('tournoi publié : nouveau prix d’entrée (sans inscrit) recalculé avec les coefficients en vigueur', async () => {
    const [admin, ana] = [await user('admin'), await user()];
    const id = await pendingProposal(ana);
    await admin.post(`/api/admin/tournaments/${id}/approve`).expect(200);
    await admin.patch(`/api/admin/tournaments/${id}`, { entryFee: 2000 }).expect(200);
    expect(await detail(admin, id)).toMatchObject({
      entryFee: 2000,
      initialTournamentTokens: 20_000,
      stakePerGame: 1000,
    });
  });

  it('approbation : commission et poids du classement copiés comme avant', async () => {
    const [admin, ana] = [await user('admin'), await user()];
    const id = await pendingProposal(ana);
    const approved = (await admin.post(`/api/admin/tournaments/${id}/approve`).expect(200)).body
      .tournament;
    expect(approved).toMatchObject({
      status: expect.stringMatching(/^(SCHEDULED|REGISTRATION_OPEN)$/),
      platformFeePercent: 15,
      rankingWeights: { tokensPercent: 60, gamesPercent: 40 },
      initialTournamentTokens: 10_000,
      stakePerGame: 500,
    });
  });
});

describe('démarrage et parties du tournoi', () => {
  it('les valeurs figées sont celles des comptes de tournoi et du règlement', async () => {
    const admin = await seedAdmin(database.sql);
    const [ana, ben, cid] = await seedPlayers(database.sql, ['ana', 'ben', 'cid'], 5000);
    const draft = await stack.tournaments.createAsPlayer(
      ana!,
      tournamentInput(stack.clock, 2 * HOUR),
    );
    expect(draft).toMatchObject({ initialTournamentTokens: 10_000, stakePerGame: 500 });
    await stack.tournaments.submit(draft.id, ana!);
    await stack.tournaments.updateSettings(admin, {
      initialTokensCoefficient: 2.5,
      stakePerGameCoefficient: 0.3,
    });
    const approved = await stack.tournaments.approve(draft.id, admin);
    expect(approved).toMatchObject({ initialTournamentTokens: 2500, stakePerGame: 300 });
    // Changement des coefficients après l'approbation : aucun effet sur ce tournoi.
    await stack.tournaments.updateSettings(admin, { initialTokensCoefficient: 40 });
    for (const p of [ana!, ben!, cid!]) await stack.tournaments.register(approved.id, p);
    await fillWith(stack, database.sql, approved.id);
    stack.clock.set(approved.startsAt);
    const started: Tournament = await stack.tournaments.advance(approved.id);
    expect(started.status).toBe('IN_PROGRESS');
    expect(await stack.repository.findAccount(started.id, ben!)).toMatchObject({
      initialTokens: 2500,
      currentTokens: 2500,
    });

    const seat = await stack.tournaments.join(started.id, ana!);
    await stack.tournaments.join(started.id, ben!);
    await stack.tournaments.join(started.id, cid!);
    await stack.games.startGame(seat.gameId, ana! as string as PlayerId);
    const game = (await stack.games.findGame(seat.gameId))!;
    await stack.tournaments.settleGame(finishedCopy(game, ben!, new Date()));
    await stack.games.finishGame(seat.gameId);
    await stack.tournaments.idle();
    expect((await stack.repository.findAccount(started.id, ben!))!.currentTokens).toBe(3100);
    expect((await stack.repository.findAccount(started.id, ana!))!.currentTokens).toBe(2200);
  });
});
