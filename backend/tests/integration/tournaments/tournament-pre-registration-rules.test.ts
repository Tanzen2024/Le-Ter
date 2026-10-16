import request from 'supertest';

import {
  TooManyWaitingTournamentsError,
  TournamentOverlapError,
  type Tournament,
  type TournamentInput,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  balances,
  createTournamentTestStack,
  fund,
  HOUR,
  MINUTE,
  saveTournamentSettings,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Règles complémentaires des préinscriptions (D-113, complète D-108) :
 * - la limite des 5 tournois aux inscriptions ouvertes compte les propositions ouvertes aux
 *   préinscriptions, et ne peut pas être contournée par des soumissions simultanées ;
 * - le chevauchement avec un tournoi publié est refusé dès la soumission (et toujours à
 *   l'approbation) ;
 * - jetons de départ et mise figés dès la première préinscription ;
 * - `nextRegistered` (GET /next) reste le prochain tournoi OFFICIEL ; aucune notification
 *   générale à la soumission.
 */
jest.setTimeout(120_000);

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;
let players: UserId[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock());
  admin = await seedAdmin(database.sql);
  players = await seedPlayers(
    database.sql,
    Array.from({ length: 8 }, (_, i) => `player-${i}`),
    5000,
  );
  await saveTournamentSettings(database.sql);
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const p = (i: number) => players[i]!;

/** Créneau n° `i` : début 2 h + i × 3 h, durée 2 h (jamais de chevauchement entre créneaux). */
const slot = (i: number, extra: Partial<TournamentInput> = {}) =>
  tournamentInput(stack.clock, 2 * HOUR + i * 3 * HOUR, extra);

const published = (i: number) => stack.tournaments.createAsAdmin(admin, slot(i));

/** Brouillon du joueur `player` au créneau `i`. */
const draft = (player: number, i: number, extra: Partial<TournamentInput> = {}) =>
  stack.tournaments.createAsPlayer(p(player), slot(i, extra));

/** Proposition soumise (préinscriptions ouvertes) du joueur `player` au créneau `i`. */
async function proposal(player: number, i: number, extra: Partial<TournamentInput> = {}) {
  const d = await draft(player, i, extra);
  return stack.tournaments.submit(d.id, p(player));
}

const status = async (t: Tournament) => (await stack.repository.findById(t.id))?.status;
const count = async (query: string, params: unknown[]) =>
  Number((await database.sql.query<{ n: number }>(query, params)).rows[0]?.n ?? 0);
const registrationsOf = (t: Tournament) =>
  count(`SELECT count(*)::int AS n FROM tournament_registrations WHERE tournament_id = $1`, [
    t.id,
  ]);
const reservationsOf = (t: Tournament) =>
  count(`SELECT count(*)::int AS n FROM wallet_reservations WHERE tournament_id = $1`, [t.id]);

async function setSetting(key: string, value: number): Promise<void> {
  await database.sql.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

/** Coefficients du fixture : jetons × 1, mise × 0,1 → 1000 / 100 pour 1000 FCFA. */
const changeCoefficients = async (tokens: number, stake: number) => {
  await setSetting('tournament_initial_tokens_coefficient', tokens);
  await setSetting('tournament_stake_per_game_coefficient', stake);
};

/** Joueur authentifié par l'API HTTP (JWT réel). */
async function httpUser(balance = 0) {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  if (balance > 0) await fund(database.sql, id, balance);
  const auth = `Bearer ${session.accessToken}`;
  return {
    id,
    get: (path: string) => request(stack.app).get(path).set('Authorization', auth),
    post: (path: string) => request(stack.app).post(path).set('Authorization', auth).send({}),
  };
}

const tokensSeenBy = async (t: Tournament, viewer: UserId) => {
  const { tournament } = await stack.tournaments.getTournament(t.id, viewer);
  return [tournament.initialTournamentTokens, tournament.stakePerGame];
};

describe('limite des 5 tournois aux inscriptions ouvertes (D-113)', () => {
  it('5 tournois ouverts : ni un 6e tournoi publié, ni une 6e proposition soumise', async () => {
    for (let i = 0; i < 5; i += 1) await published(i);
    await expect(published(5)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);
    // Le brouillon reste possible (privé, fermé) ; sa soumission est refusée.
    await expect(draft(0, 6)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);
  });

  it('une proposition en attente d’approbation compte dans la limite', async () => {
    for (let i = 0; i < 4; i += 1) await published(i);
    const t = await proposal(0, 4);
    expect(t.status).toBe('PENDING_APPROVAL');
    await expect(published(5)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);
    const second = await stack.tournaments.createAsPlayer(p(1), slot(6)).catch((e) => e);
    expect(second).toBeInstanceOf(TooManyWaitingTournamentsError);
  });

  it('soumission refusée : la proposition reste un brouillon, rien n’est inscrit ni réservé', async () => {
    for (let i = 0; i < 4; i += 1) await published(i);
    const d = await draft(0, 4);
    await published(5);
    await expect(stack.tournaments.submit(d.id, p(0))).rejects.toBeInstanceOf(
      TooManyWaitingTournamentsError,
    );
    expect(await status(d)).toBe('DRAFT');
    expect([await registrationsOf(d), await reservationsOf(d)]).toEqual([0, 0]);
  });

  it('l’approbation d’une proposition déjà comptée ne la compte pas deux fois', async () => {
    for (let i = 0; i < 4; i += 1) await published(i);
    const t = await proposal(0, 4);
    await stack.tournaments.register(t.id, p(1));
    const approved = await stack.tournaments.approve(t.id, admin);
    expect(approved.status).toBe('REGISTRATION_OPEN');
    await expect(published(5)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);
  });

  it('brouillons, tournois aux inscriptions closes et propositions closes ne comptent pas', async () => {
    for (let i = 0; i < 3; i += 1) await published(i);
    // Brouillons : jamais comptés.
    await draft(0, 3);
    await draft(1, 4);
    // Tournoi publié dont les inscriptions ferment dans 30 min, puis closes.
    const closing = await stack.tournaments.createAsAdmin(
      admin,
      slot(5, { registrationClosesAt: new Date(stack.clock.now().getTime() + 30 * MINUTE) }),
    );
    // Proposition dont la fenêtre de préinscription ferme dans 30 min.
    const closingProposal = await proposal(
      2,
      6,
      { registrationClosesAt: new Date(stack.clock.now().getTime() + 30 * MINUTE) },
    );
    await expect(published(7)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);
    stack.clock.advance(31 * MINUTE);
    await stack.tournaments.advance(closing.id);
    expect(await status(closing)).toBe('REGISTRATION_CLOSED');
    expect(await status(closingProposal)).toBe('PENDING_APPROVAL');
    // 3 ouverts + 2 brouillons + 1 fermé + 1 proposition close : deux places libres.
    await published(7);
    await published(8);
    await expect(published(9)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);
  });

  it('annulation, refus ou retrait libèrent la place', async () => {
    const opened = [];
    for (let i = 0; i < 3; i += 1) opened.push(await published(i));
    const rejected = await proposal(0, 3);
    const withdrawn = await proposal(1, 4);
    await expect(published(5)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);

    await stack.tournaments.cancel(opened[0]!.id, { userId: admin, isAdmin: true });
    await published(5);
    await expect(published(6)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);

    await stack.tournaments.reject(rejected.id, admin);
    await published(6);
    await expect(published(7)).rejects.toBeInstanceOf(TooManyWaitingTournamentsError);

    await stack.tournaments.cancel(withdrawn.id, { userId: p(1), isAdmin: false });
    await published(7);
  });

  it('soumissions simultanées : jamais plus de 5, une seule passe pour la dernière place', async () => {
    for (let i = 0; i < 4; i += 1) await published(i);
    const drafts = await Promise.all([0, 1, 2].map((player) => draft(player, 4 + player)));
    const outcomes = await Promise.allSettled(
      drafts.map((d, player) => stack.tournaments.submit(d.id, p(player))),
    );
    const accepted = outcomes.filter((o) => o.status === 'fulfilled');
    const refused = outcomes.filter(
      (o) => o.status === 'rejected' && o.reason instanceof TooManyWaitingTournamentsError,
    );
    expect([accepted.length, refused.length]).toEqual([1, 2]);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM tournaments
         WHERE status IN ('SCHEDULED', 'REGISTRATION_OPEN', 'PENDING_APPROVAL')`,
        [],
      ),
    ).toBe(5);
  });

  it('création admin et soumission simultanées pour la dernière place : une seule passe', async () => {
    for (let i = 0; i < 4; i += 1) await published(i);
    const d = await draft(0, 4);
    const outcomes = await Promise.allSettled([
      stack.tournaments.submit(d.id, p(0)),
      published(5),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM tournaments
         WHERE status IN ('SCHEDULED', 'REGISTRATION_OPEN', 'PENDING_APPROVAL')`,
        [],
      ),
    ).toBe(5);
  });
});

describe('chevauchement contrôlé dès la soumission (D-113)', () => {
  it('créneau déjà occupé par un tournoi publié : soumission refusée, rien d’inscrit', async () => {
    await published(0);
    const d = await stack.tournaments.createAsPlayer(
      p(0),
      tournamentInput(stack.clock, 2 * HOUR + 30 * MINUTE),
    );
    await expect(stack.tournaments.submit(d.id, p(0))).rejects.toBeInstanceOf(
      TournamentOverlapError,
    );
    expect(await status(d)).toBe('DRAFT');
    expect([await registrationsOf(d), await reservationsOf(d)]).toEqual([0, 0]);
    // Toujours invisible et fermé aux autres.
    const list = await stack.tournaments.listForPlayer(p(1));
    expect(list.current.map((s) => s.tournament.id)).not.toContain(d.id);
  });

  it('erreur HTTP explicite : 409 TOURNAMENT_OVERLAP', async () => {
    await published(0);
    const ana = await httpUser();
    const d = await stack.tournaments.createAsPlayer(
      ana.id,
      tournamentInput(stack.clock, 2 * HOUR + 30 * MINUTE),
    );
    const res = await ana.post(`/api/tournaments/${d.id}/submit`);
    expect([res.status, res.body.code, res.body.message]).toEqual([
      409,
      'TOURNAMENT_OVERLAP',
      'Un autre tournoi est déjà programmé sur ce créneau.',
    ]);
  });

  it('créneaux persistés : la période de transition du tournoi publié est respectée', async () => {
    await setSetting('tournament_transition_minutes', 30);
    const t = await published(0);
    const blockedUntil = (await stack.repository.findById(t.id))!.blockedUntil!;
    const startingAt = (at: Date) => ({
      startsAt: at,
      endsAt: new Date(at.getTime() + 2 * HOUR),
    });
    // Après la fin, mais pendant la transition : refusé.
    const inMargin = await stack.tournaments.createAsPlayer(
      p(0),
      { ...slot(0), ...startingAt(new Date(blockedUntil.getTime() - 10 * MINUTE)) },
    );
    await expect(stack.tournaments.submit(inMargin.id, p(0))).rejects.toBeInstanceOf(
      TournamentOverlapError,
    );
    await stack.tournaments.cancel(inMargin.id, { userId: p(0), isAdmin: false });
    // Juste à la fin de la transition : accepté (créneaux qui se suivent).
    const adjacent = await stack.tournaments.createAsPlayer(
      p(0),
      { ...slot(0), ...startingAt(blockedUntil) },
    );
    expect((await stack.tournaments.submit(adjacent.id, p(0))).status).toBe('PENDING_APPROVAL');
  });

  it('la marge de la proposition est aussi prise en compte (fin + transition)', async () => {
    await setSetting('tournament_transition_minutes', 30);
    const t = await published(1); // début à 5 h
    // Proposition de 2 h 45 à 4 h 45 : finie avant le début du tournoi publié (5 h), mais sa
    // transition (jusqu'à 5 h 15) le recouvre.
    const startsAt = new Date(t.startsAt.getTime() - 2 * HOUR - 15 * MINUTE);
    const d = await stack.tournaments.createAsPlayer(p(0), {
      ...slot(0),
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * HOUR),
    });
    await expect(stack.tournaments.submit(d.id, p(0))).rejects.toBeInstanceOf(
      TournamentOverlapError,
    );
  });

  it('deux propositions sur le même créneau restent possibles ; l’approbation tranche', async () => {
    const first = await proposal(0, 0);
    const second = await proposal(1, 0);
    await stack.tournaments.register(second.id, p(2));
    await stack.tournaments.approve(first.id, admin);
    await expect(stack.tournaments.approve(second.id, admin)).rejects.toBeInstanceOf(
      TournamentOverlapError,
    );
    expect(await status(second)).toBe('PENDING_APPROVAL');
    expect(await reservationsOf(second)).toBe(1);
  });

  it('modification d’une proposition vers un créneau occupé : refusée, inchangée', async () => {
    await published(0);
    const t = await proposal(0, 1);
    const target = slot(0, {});
    await expect(
      stack.tournaments.update(t.id, { userId: p(0), isAdmin: false }, {
        startsAt: new Date(target.startsAt.getTime() + 30 * MINUTE),
        endsAt: new Date(target.endsAt.getTime() + 30 * MINUTE),
      }),
    ).rejects.toBeInstanceOf(TournamentOverlapError);
    expect((await stack.repository.findById(t.id))!.startsAt).toEqual(t.startsAt);
  });

  it('création admin et soumission simultanées sur un même créneau : jamais deux publiés', async () => {
    const d = await draft(0, 0);
    const outcomes = await Promise.allSettled([
      stack.tournaments.submit(d.id, p(0)),
      published(0),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    if ((await status(d)) === 'PENDING_APPROVAL') {
      // La soumission est passée avant la publication : l'approbation garde la garantie.
      await expect(stack.tournaments.approve(d.id, admin)).rejects.toBeInstanceOf(
        TournamentOverlapError,
      );
    }
    expect(
      await count(
        `SELECT count(*)::int AS n FROM tournaments
         WHERE status IN ('SCHEDULED', 'REGISTRATION_OPEN')`,
        [],
      ),
    ).toBe(1);
  });
});

describe('jetons de départ et mise figés à la première préinscription (D-113)', () => {
  it('avant toute préinscription, les valeurs suivent les coefficients (D-071)', async () => {
    const t = await proposal(0, 0);
    expect(await tokensSeenBy(t, p(1))).toEqual([1000, 100]);
    await changeCoefficients(2, 0.2);
    expect(await tokensSeenBy(t, p(1))).toEqual([2000, 200]);
  });

  it('coefficients modifiés après la préinscription : valeurs promises inchangées, approbation comprise', async () => {
    const t = await proposal(0, 0);
    await stack.tournaments.register(t.id, p(1));
    await changeCoefficients(2, 0.2);
    expect(await tokensSeenBy(t, p(1))).toEqual([1000, 100]);
    expect(await tokensSeenBy(t, p(5))).toEqual([1000, 100]);
    const before = await balances(database.sql, p(1));
    const approved = await stack.tournaments.approve(t.id, admin);
    expect([approved.initialTournamentTokens, approved.stakePerGame]).toEqual([1000, 100]);
    expect(await tokensSeenBy(t, p(1))).toEqual([1000, 100]);
    // Réservation conservée telle quelle, aucun débit, aucune réinscription.
    expect(await balances(database.sql, p(1))).toEqual(before);
    expect(before).toEqual({ balance: 5000, reserved: 1000, available: 4000 });
    expect(await reservationsOf(t)).toBe(1);
  });

  it('figées aux valeurs affichées lors de la première préinscription, pas de la soumission', async () => {
    const t = await proposal(0, 0);
    await changeCoefficients(3, 0.5);
    await stack.tournaments.register(t.id, p(1));
    await changeCoefficients(1, 0.1);
    expect(await tokensSeenBy(t, p(2))).toEqual([3000, 500]);
    const approved = await stack.tournaments.approve(t.id, admin);
    expect([approved.initialTournamentTokens, approved.stakePerGame]).toEqual([3000, 500]);
  });

  it('les préinscriptions suivantes ne refigent pas ; une désinscription non plus', async () => {
    const t = await proposal(0, 0);
    await stack.tournaments.register(t.id, p(1));
    await changeCoefficients(2, 0.2);
    await stack.tournaments.register(t.id, p(2));
    await stack.tournaments.unregister(t.id, p(1));
    await stack.tournaments.unregister(t.id, p(2));
    expect(await tokensSeenBy(t, p(3))).toEqual([1000, 100]);
  });

  it('nouveau prix d’entrée sans inscrit actif : les valeurs suivent de nouveau les coefficients', async () => {
    const t = await proposal(0, 0);
    await stack.tournaments.register(t.id, p(1));
    await stack.tournaments.unregister(t.id, p(1));
    await changeCoefficients(2, 0.2);
    const updated = await stack.tournaments.update(
      t.id,
      { userId: p(0), isAdmin: false },
      { entryFee: 1500 },
    );
    expect(updated.tokenSetupFrozenAt).toBeUndefined();
    expect(await tokensSeenBy(t, p(3))).toEqual([3000, 300]);
  });

  it('préinscriptions simultanées : figées une seule fois, aux mêmes valeurs', async () => {
    const t = await proposal(0, 0);
    await Promise.all([1, 2, 3].map((i) => stack.tournaments.register(t.id, p(i))));
    const frozen = (await stack.repository.findById(t.id))!;
    expect(frozen.tokenSetupFrozenAt).toBeInstanceOf(Date);
    expect([frozen.initialTournamentTokens, frozen.stakePerGame]).toEqual([1000, 100]);
  });

  it('commission et poids restent figés à la publication, pas à la préinscription', async () => {
    const t = await proposal(0, 0);
    await stack.tournaments.register(t.id, p(1));
    await setSetting('tournament_platform_fee_percent', 20);
    const approved = await stack.tournaments.approve(t.id, admin);
    expect(approved.platformFeeBps).toBe(2000);
  });
});

describe('prochain tournoi et notifications (D-113)', () => {
  it('GET /next ne désigne qu’un tournoi officiel, jamais une proposition en attente', async () => {
    const t = await proposal(0, 0);
    const ben = await httpUser(5000);
    await ben.post(`/api/tournaments/${t.id}/register`).expect(201);
    expect((await ben.get('/api/tournaments/next').expect(200)).body.tournament).toBeNull();
    await stack.tournaments.approve(t.id, admin);
    const next = await ben.get('/api/tournaments/next').expect(200);
    expect(next.body.tournament).toMatchObject({ tournamentId: t.id });
  });

  it('aucune notification aux autres joueurs à la soumission ; visible à la prochaine lecture', async () => {
    const t = await proposal(0, 0);
    for (const viewer of [p(1), p(2)]) {
      expect((await stack.notifications.list(viewer)).notifications).toEqual([]);
      const list = await stack.tournaments.listForPlayer(viewer);
      expect(list.current.map((s) => s.tournament.id)).toContain(t.id);
    }
  });
});
