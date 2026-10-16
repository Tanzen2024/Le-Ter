import {
  AlreadyRegisteredError,
  InvalidTournamentTransitionError,
  TournamentFullError,
  TournamentLockedError,
  TournamentNotFoundError,
  TournamentOverlapError,
  TournamentRegistrationClosedError,
  type Tournament,
  type TournamentInput,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import type { UserEvent } from '../../../src/websocket/user-event-bus';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  balances,
  createTournamentTestStack,
  fillWith,
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
 * Préinscriptions aux propositions de joueurs (D-108) : une proposition soumise est visible
 * et ouverte aux inscriptions (avec réservation, D-054) avant l'approbation ; l'approbation ne
 * demande plus 1 h d'avance et conserve les préinscriptions ; le refus les annule et libère
 * les réservations, une seule fois ; une proposition ne démarre jamais.
 */
jest.setTimeout(90_000);

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;
let players: UserId[];
let signals: UserEvent[];
const FEE = 1000;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  signals = [];
  stack = createTournamentTestStack(database.sql, new TestClock(), {
    userEvents: { publish: (e) => signals.push(e) },
  });
  admin = await seedAdmin(database.sql);
  players = await seedPlayers(database.sql, ['ana', 'ben', 'cid', 'dan'], 5000);
  await saveTournamentSettings(database.sql);
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const [ANA, BEN, CID, DAN] = [0, 1, 2, 3];
const p = (i: number) => players[i]!;

/** Proposition d'Ana soumise : en attente d'approbation, préinscriptions ouvertes. */
async function proposal(startsInMs = 2 * HOUR, extra: Partial<TournamentInput> = {}) {
  const draft = await stack.tournaments.createAsPlayer(
    p(ANA),
    tournamentInput(stack.clock, startsInMs, extra),
  );
  return stack.tournaments.submit(draft.id, p(ANA));
}

const status = async (t: Tournament) => (await stack.repository.findById(t.id))?.status;
const reservations = async (t: Tournament) =>
  (
    await database.sql.query<{ status: string }>(
      `SELECT status FROM wallet_reservations WHERE tournament_id = $1 ORDER BY status`,
      [t.id],
    )
  ).rows.map((r) => r.status);
const notificationTypes = async (user: UserId) =>
  (await stack.notifications.list(user)).notifications.map((n) => n.type).sort();

describe('proposition soumise : visible et ouverte aux préinscriptions', () => {
  it('visible des autres joueurs (liste et fiche) avec l’inscription possible', async () => {
    const t = await proposal();
    expect(t.status).toBe('PENDING_APPROVAL');
    const list = await stack.tournaments.listForPlayer(p(BEN));
    expect(list.current.map((s) => s.tournament.id)).toContain(t.id);
    const seen = await stack.tournaments.getTournament(t.id, p(BEN));
    expect(seen.tournament.status).toBe('PENDING_APPROVAL');
  });

  it('un brouillon non soumis reste privé et fermé', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    const list = await stack.tournaments.listForPlayer(p(BEN));
    expect(list.current.map((s) => s.tournament.id)).not.toContain(draft.id);
    await expect(stack.tournaments.getTournament(draft.id, p(BEN))).rejects.toBeInstanceOf(
      TournamentNotFoundError,
    );
    await expect(stack.tournaments.register(draft.id, p(BEN))).rejects.toBeInstanceOf(
      TournamentRegistrationClosedError,
    );
  });

  it('préinscription : réservation du prix (aucun débit), confirmation notifiée', async () => {
    const t = await proposal();
    const snapshot = await stack.tournaments.register(t.id, p(BEN));
    expect(snapshot.registeredCount).toBe(1);
    expect(snapshot.registration?.status).toBe('REGISTERED');
    expect(await balances(database.sql, p(BEN))).toEqual({
      balance: 5000,
      reserved: FEE,
      available: 5000 - FEE,
    });
    expect(await reservations(t)).toEqual(['ACTIVE']);
    expect(await notificationTypes(p(BEN))).toEqual(['TOURNAMENT_REGISTRATION_CONFIRMED']);
    // Aucun compte de tournoi, aucun jeton de tournoi avant le démarrage.
    expect(await stack.repository.findAccount(t.id, p(BEN))).toBeNull();
  });

  it('désinscription possible avant l’approbation : réservation libérée', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await stack.tournaments.unregister(t.id, p(BEN));
    expect(await balances(database.sql, p(BEN))).toMatchObject({ reserved: 0 });
    expect(await reservations(t)).toEqual(['RELEASED']);
  });

  it('double inscription impossible, même avec deux requêtes simultanées', async () => {
    const t = await proposal();
    const outcomes = await Promise.allSettled([
      stack.tournaments.register(t.id, p(BEN)),
      stack.tournaments.register(t.id, p(BEN)),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AlreadyRegisteredError);
    expect(await balances(database.sql, p(BEN))).toMatchObject({ reserved: FEE });
    expect(await reservations(t)).toEqual(['ACTIVE']);
  });

  it('capacité maximale appliquée aux préinscriptions', async () => {
    const t = await proposal(2 * HOUR, { maximumPlayers: 20 });
    await fillWith(stack, database.sql, t.id, 20);
    await expect(stack.tournaments.register(t.id, p(BEN))).rejects.toBeInstanceOf(
      TournamentFullError,
    );
  });

  it('date et conditions figées dès la première préinscription (créateur et admin)', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    const later = new Date(t.startsAt.getTime() + HOUR);
    const patch = { startsAt: later, endsAt: new Date(later.getTime() + 2 * HOUR) };
    await expect(
      stack.tournaments.update(t.id, { userId: p(ANA), isAdmin: false }, patch),
    ).rejects.toBeInstanceOf(TournamentLockedError);
    await expect(
      stack.tournaments.update(t.id, { userId: admin, isAdmin: true }, patch),
    ).rejects.toBeInstanceOf(TournamentLockedError);
    expect((await stack.repository.findById(t.id))?.startsAt).toEqual(t.startsAt);
  });
});

describe('approbation (D-108 : plus de délai d’1 h)', () => {
  it('approuvée 10 min avant le début, préinscriptions conservées sans réinscription', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await stack.tournaments.register(t.id, p(CID));
    stack.clock.set(new Date(t.startsAt.getTime() - 10 * MINUTE));

    const approved = await stack.tournaments.approve(t.id, admin);

    expect(approved.status).toBe('REGISTRATION_OPEN');
    expect(approved.publishedAt).toBeDefined();
    expect(approved.platformFeeBps).toBe(1000);
    const snapshot = await stack.tournaments.getTournament(t.id, p(BEN));
    expect(snapshot.registeredCount).toBe(2);
    expect(snapshot.registration?.status).toBe('REGISTERED');
    // Mêmes réservations : rien de dupliqué, rien de libéré.
    expect(await reservations(t)).toEqual(['ACTIVE', 'ACTIVE']);
    expect(await balances(database.sql, p(BEN))).toMatchObject({ reserved: FEE });
    await expect(stack.tournaments.register(t.id, p(BEN))).rejects.toBeInstanceOf(
      AlreadyRegisteredError,
    );
    // Créateur ET préinscrits informés (notification + signal temps réel) ; seuls les
    // préinscrits sont marqués `preRegistered` (texte adapté sur le mobile).
    for (const who of [ANA, BEN, CID]) {
      expect(await notificationTypes(p(who))).toContain('TOURNAMENT_APPROVED');
    }
    const approvalOf = async (who: number) =>
      (await stack.notifications.list(p(who))).notifications.find(
        (n) => n.type === 'TOURNAMENT_APPROVED',
      )?.payload;
    expect(await approvalOf(BEN)).toMatchObject({ preRegistered: true, tournamentId: t.id });
    expect(await approvalOf(ANA)).not.toHaveProperty('preRegistered');
    expect(
      signals
        .filter((s) => s.notificationType === 'TOURNAMENT_APPROVED')
        .map((s) => s.userId)
        .sort(),
    ).toEqual([p(ANA), p(BEN), p(CID)].sort());
  });

  it('démarrage normal ensuite : les préinscriptions sont capturées au début', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await fillWith(stack, database.sql, t.id);
    stack.clock.set(new Date(t.startsAt.getTime() - 5 * MINUTE));
    await stack.tournaments.approve(t.id, admin);
    stack.clock.set(t.startsAt);
    expect((await stack.tournaments.advance(t.id)).status).toBe('IN_PROGRESS');
    expect(await balances(database.sql, p(BEN))).toEqual({
      balance: 5000 - FEE,
      reserved: 0,
      available: 5000 - FEE,
    });
    expect(await stack.repository.findAccount(t.id, p(BEN))).not.toBeNull();
  });

  it('approuvée après la clôture choisie des inscriptions : préinscrits conservés, plus d’inscription', async () => {
    const startsAt = new Date(stack.clock.now().getTime() + 2 * HOUR);
    const t = await proposal(2 * HOUR, {
      registrationClosesAt: new Date(startsAt.getTime() - 30 * MINUTE),
    });
    await stack.tournaments.register(t.id, p(BEN));
    stack.clock.set(new Date(startsAt.getTime() - 10 * MINUTE));

    const approved = await stack.tournaments.approve(t.id, admin);

    expect(approved.status).toBe('REGISTRATION_CLOSED');
    expect(await reservations(t)).toEqual(['ACTIVE']);
    await expect(stack.tournaments.register(t.id, p(CID))).rejects.toBeInstanceOf(
      TournamentRegistrationClosedError,
    );
  });

  it('approbation refusée si le début est déjà passé ; elle n’ouvre aucun démarrage', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    stack.clock.set(new Date(t.startsAt.getTime() + MINUTE));
    await expect(stack.tournaments.approve(t.id, admin)).rejects.toMatchObject({
      name: 'InvalidTournamentError',
      fields: { startsAt: 'Le début doit être dans le futur.' },
    });
    expect(await status(t)).toBe('PENDING_APPROVAL');
  });

  it('les autres règles restent appliquées : chevauchement refusé, préinscriptions intactes', async () => {
    // Le tournoi concurrent est publié APRÈS la soumission (D-113 refuse la soumission d'un
    // créneau déjà occupé) : l'approbation garde son propre contrôle.
    const t = await proposal(2 * HOUR + 30 * MINUTE);
    await stack.tournaments.register(t.id, p(BEN));
    await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, 2 * HOUR));
    await expect(stack.tournaments.approve(t.id, admin)).rejects.toBeInstanceOf(
      TournamentOverlapError,
    );
    expect(await status(t)).toBe('PENDING_APPROVAL');
    expect(await reservations(t)).toEqual(['ACTIVE']);
  });

  it('la soumission exige toujours 1 h d’avance', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    stack.clock.advance(90 * MINUTE);
    await expect(stack.tournaments.submit(draft.id, p(ANA))).rejects.toMatchObject({
      fields: { startsAt: 'Le tournoi doit commencer au moins 1 h plus tard.' },
    });
  });

  it('ancienne proposition sans préinscription : approuvée comme avant', async () => {
    const t = await proposal(3 * HOUR);
    const approved = await stack.tournaments.approve(t.id, admin);
    expect(approved.status).toBe('REGISTRATION_OPEN');
    expect(await notificationTypes(p(ANA))).toEqual(['TOURNAMENT_APPROVED']);
  });
});

describe('refus, retrait et expiration', () => {
  it('refus : préinscriptions annulées, réservations libérées, inscrits informés', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await stack.tournaments.register(t.id, p(CID));

    const rejected = await stack.tournaments.reject(t.id, admin);

    expect(rejected).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'APPROVAL_REJECTED',
    });
    expect(await reservations(t)).toEqual(['RELEASED', 'RELEASED']);
    for (const who of [BEN, CID]) {
      expect(await balances(database.sql, p(who))).toEqual({
        balance: 5000,
        reserved: 0,
        available: 5000,
      });
      expect(await notificationTypes(p(who))).toContain('TOURNAMENT_CANCELLED');
    }
    expect(await notificationTypes(p(ANA))).toEqual(['TOURNAMENT_CANCELLED']);
    expect(
      signals.filter((s) => s.notificationType === 'TOURNAMENT_CANCELLED').map((s) => s.userId),
    ).toEqual(expect.arrayContaining([p(ANA), p(BEN), p(CID)]));
    // Plus aucune inscription ; aucun compte de tournoi, aucune partie.
    await expect(stack.tournaments.register(t.id, p(DAN))).rejects.toBeInstanceOf(
      TournamentRegistrationClosedError,
    );
    expect(await stack.repository.findAccount(t.id, p(BEN))).toBeNull();
  });

  it('refus idempotent : rien n’est libéré ni notifié deux fois', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await stack.tournaments.reject(t.id, admin);
    const before = await stack.notifications.list(p(BEN));
    signals = [];

    const again = await stack.tournaments.reject(t.id, admin);

    expect(again.status).toBe('CANCELLED');
    expect(await balances(database.sql, p(BEN))).toMatchObject({ balance: 5000, reserved: 0 });
    expect(await reservations(t)).toEqual(['RELEASED']);
    expect((await stack.notifications.list(p(BEN))).notifications).toHaveLength(
      before.notifications.length,
    );
    expect(signals).toEqual([]);
    const audits = await database.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log
       WHERE target_id = $1 AND action = 'TOURNAMENT_REJECTED'`,
      [t.id],
    );
    expect(Number(audits.rows[0]?.n)).toBe(1);
  });

  it('un tournoi publié ne peut pas être « refusé »', async () => {
    const t = await proposal();
    await stack.tournaments.approve(t.id, admin);
    await expect(stack.tournaments.reject(t.id, admin)).rejects.toBeInstanceOf(
      InvalidTournamentTransitionError,
    );
  });

  it('proposition refusée : visible de ses préinscrits, introuvable pour les autres', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await stack.tournaments.reject(t.id, admin);
    expect((await stack.tournaments.getTournament(t.id, p(BEN))).tournament.status).toBe(
      'CANCELLED',
    );
    await expect(stack.tournaments.getTournament(t.id, p(DAN))).rejects.toBeInstanceOf(
      TournamentNotFoundError,
    );
    const list = await stack.tournaments.listForPlayer(p(DAN));
    expect(list.current.map((s) => s.tournament.id)).not.toContain(t.id);
  });

  it('retrait par le créateur : préinscriptions annulées et réservations libérées', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    const withdrawn = await stack.tournaments.cancel(t.id, { userId: p(ANA), isAdmin: false });
    expect(withdrawn.cancellationReason).toBe('CREATOR_CANCELLED');
    expect(await reservations(t)).toEqual(['RELEASED']);
    expect(await balances(database.sql, p(BEN))).toMatchObject({ reserved: 0 });
  });

  it('annulation administrative pendant les préinscriptions : fonds libérés', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await stack.tournaments.cancel(t.id, { userId: admin, isAdmin: true });
    expect(await status(t)).toBe('CANCELLED');
    expect(await reservations(t)).toEqual(['RELEASED']);
    await expect(stack.tournaments.register(t.id, p(CID))).rejects.toBeInstanceOf(
      TournamentRegistrationClosedError,
    );
  });

  it('jamais approuvée avant son début : ne démarre pas, rien n’est capturé', async () => {
    const t = await proposal();
    await stack.tournaments.register(t.id, p(BEN));
    await fillWith(stack, database.sql, t.id);
    stack.clock.set(t.startsAt);

    const after = await stack.tournaments.advance(t.id);

    expect(after.status).toBe('CANCELLED');
    expect(after.startedAt).toBeUndefined();
    expect(await reservations(t)).not.toContain('CAPTURED');
    expect(await reservations(t)).not.toContain('ACTIVE');
    expect(await balances(database.sql, p(BEN))).toMatchObject({ balance: 5000, reserved: 0 });
    expect(await stack.repository.findAccount(t.id, p(BEN))).toBeNull();
    const sessions = await database.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tournament_sessions WHERE tournament_id = $1`,
      [t.id],
    );
    expect(Number(sessions.rows[0]?.n)).toBe(0);
    expect(await notificationTypes(p(BEN))).toContain('TOURNAMENT_CANCELLED');
  });
});
