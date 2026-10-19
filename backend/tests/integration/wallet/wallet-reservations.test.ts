import { randomUUID } from 'node:crypto';

import type { TournamentId } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { PostgresTournamentRepository } from '../../../src/repositories/postgres-tournament.repository';
import { InsufficientBalanceError } from '../../../src/domain/wallet/wallet';
import { PostgresWalletRepository } from '../../../src/repositories/postgres-wallet.repository';
import {
  captureReservation,
  creditTournamentPrize,
  releaseReservation,
  ReservationNotActiveError,
  reserveFunds,
} from '../../../src/repositories/wallet-reservations';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { balances, fund, HOUR, seedPlayers } from '../../fixtures/tournaments';

/**
 * Réservations du compte de jeu (D-054) : disponible = solde − réservé ; réserver ne débite
 * pas ; libérer rend le disponible ; capturer débite une fois (transaction tracée) ; un gain
 * est crédité une fois par clé. Invariants garantis en base.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let player: UserId;
let tournamentId: string;
let registrationId: string;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  player = (await seedPlayers(database.sql, ['rita'], 5000))[0]!;
  tournamentId = randomUUID();
  registrationId = randomUUID();
  const now = new Date();
  await database.sql.query(
    // Schéma courant : plus de nom (D-060, migration 0024) ; les autres colonnes ont leur
    // valeur par défaut (brouillon).
    `INSERT INTO tournaments (id, starts_at, ends_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [tournamentId, new Date(now.getTime() + HOUR), new Date(now.getTime() + 3 * HOUR), now],
  );
  await database.sql.query(
    `INSERT INTO tournament_registrations (id, tournament_id, user_id, status, registered_at)
     VALUES ($1, $2, $3, 'REGISTERED', $4)`,
    [registrationId, tournamentId, player, now],
  );
});
afterEach(() => database.reset());

const reserve = (amount: number) =>
  database.sql.transaction((tx) =>
    reserveFunds(tx, { userId: player!, tournamentId, registrationId, amount, now: new Date() }),
  );

const transactions = async (kind: string) =>
  (
    await database.sql.query<{ tokens: string }>(
      'SELECT tokens FROM wallet_transactions WHERE user_id = $1 AND kind = $2',
      [player, kind],
    )
  ).rows.map((r) => Number(r.tokens));

describe('réservation', () => {
  it('bloque le montant sans débit : solde 5 000, réservé 1 000, disponible 4 000', async () => {
    await reserve(1000);
    expect(await balances(database.sql, player!)).toEqual({
      balance: 5000,
      reserved: 1000,
      available: 4000,
    });
    expect(await transactions('tournament_entry')).toEqual([]);
  });

  it('refuse au-delà du disponible et n’écrit rien', async () => {
    await expect(reserve(6000)).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(await balances(database.sql, player!)).toMatchObject({ reserved: 0, available: 5000 });
  });

  it('une seule réservation vivante par inscription (garanti en base)', async () => {
    await reserve(1000);
    await expect(reserve(1000)).rejects.toMatchObject({ code: '23505' });
  });

  it('un retrait ne peut pas entamer le montant réservé', async () => {
    await reserve(4500);
    const wallets = new PostgresWalletRepository(database.sql);
    const now = new Date();
    await expect(
      wallets.createPendingWithdrawal({
        id: randomUUID(),
        userId: player!,
        kind: 'withdrawal',
        status: 'pending',
        tokens: 1000,
        idempotencyKey: `w-${randomUUID()}`,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});

describe('libération', () => {
  it('rend le disponible, sans transaction, et est idempotente', async () => {
    const r = await reserve(1000);
    const first = await database.sql.transaction((tx) => releaseReservation(tx, r.id, new Date()));
    const again = await database.sql.transaction((tx) => releaseReservation(tx, r.id, new Date()));
    expect(first.changed).toBe(true);
    expect(again.changed).toBe(false);
    expect(first.reservation.status).toBe('RELEASED');
    expect(await balances(database.sql, player!)).toEqual({
      balance: 5000,
      reserved: 0,
      available: 5000,
    });
    expect(await transactions('tournament_entry')).toEqual([]);
  });
});

describe('capture', () => {
  it('débite solde ET réservé une seule fois, avec une transaction tournament_entry', async () => {
    const r = await reserve(1000);
    const first = await database.sql.transaction((tx) => captureReservation(tx, r.id, new Date()));
    const again = await database.sql.transaction((tx) => captureReservation(tx, r.id, new Date()));
    expect(first.changed).toBe(true);
    expect(again.changed).toBe(false);
    expect(await balances(database.sql, player!)).toEqual({
      balance: 4000,
      reserved: 0,
      available: 4000,
    });
    expect(await transactions('tournament_entry')).toEqual([1000]);
  });

  it('refuse de capturer une réservation libérée (aucun débit)', async () => {
    const r = await reserve(1000);
    await database.sql.transaction((tx) => releaseReservation(tx, r.id, new Date()));
    await expect(
      database.sql.transaction((tx) => captureReservation(tx, r.id, new Date())),
    ).rejects.toBeInstanceOf(ReservationNotActiveError);
    expect(await balances(database.sql, player!)).toMatchObject({ balance: 5000 });
  });

  it('le réservé ne peut jamais dépasser le solde (contrainte en base)', async () => {
    await expect(
      database.sql.query('UPDATE wallets SET reserved = balance + 1 WHERE user_id = $1', [player]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('gain de tournoi', () => {
  // D-112 / migration 0045 : un gain `tournament_prize` n'existe que comme preuve de crédit
  // d'une ligne CREDITED du plan de versement (même joueur, montant, référence), écrite dans
  // la MÊME transaction — exactement ce que fait TournamentService.distributeOne.
  const prizeKey = () => `tournament-prize:${tournamentId}:1`;

  /** Classement officiel (rang 1) et sa ligne du plan de versement, en attente. */
  async function seedPayout(amount: number) {
    await database.sql.query(
      `INSERT INTO tournament_results (tournament_id, rank, player_id, initial_tokens,
         remaining_tokens, games_played, games_won, prize_share_bps, prize_amount, created_at)
       VALUES ($1, 1, $2, 1000, 1000, 0, 0, 10000, $3, now())`,
      [tournamentId, player, amount],
    );
    await database.sql.query(
      `INSERT INTO tournament_payouts (tournament_id, rank, player_id, amount, idempotency_key,
         status, created_at)
       VALUES ($1, 1, $2, $3, $4, 'PENDING', now())`,
      [tournamentId, player, amount, prizeKey()],
    );
  }

  /** Versement par le flux métier : crédit du compte de jeu + versement CREDITED, ensemble. */
  const payPrize = (amount: number) =>
    new PostgresTournamentRepository(database.sql).transaction(async (uow) => {
      const now = new Date();
      const credit = await uow.creditPrize({
        userId: player!,
        amount,
        idempotencyKey: prizeKey(),
        now,
      });
      await uow.markPayoutCredited(tournamentId as TournamentId, 1, credit.transactionId, now);
      return credit;
    });

  /** Reprise du seul crédit (même clé), comme après une panne entre deux tentatives. */
  const creditAgain = (amount: number) =>
    database.sql.transaction((tx) =>
      creditTournamentPrize(tx, {
        userId: player!,
        amount,
        idempotencyKey: prizeKey(),
        now: new Date(),
      }),
    );

  const payout = async () =>
    (
      await database.sql.query<{ status: string; wallet_transaction_id: string | null }>(
        'SELECT status, wallet_transaction_id FROM tournament_payouts WHERE tournament_id = $1',
        [tournamentId],
      )
    ).rows[0];

  it('crédité une seule fois par clé d’idempotence', async () => {
    await seedPayout(45_000);
    const first = await payPrize(45_000);
    const again = await creditAgain(45_000);
    expect(first.credited).toBe(true);
    expect(again).toEqual({ transactionId: first.transactionId, credited: false });
    expect(await transactions('tournament_prize')).toEqual([45_000]);
    expect((await balances(database.sql, player!)).balance).toBe(50_000);
    // Plan et compte de jeu cohérents : le versement pointe sur l'unique crédit.
    expect(await payout()).toEqual({
      status: 'CREDITED',
      wallet_transaction_id: first.transactionId,
    });
    // Un second versement du même rang est refusé et n'écrit rien.
    await expect(payPrize(45_000)).rejects.toThrow(/déjà crédité/);
    expect(await transactions('tournament_prize')).toEqual([45_000]);
    expect((await balances(database.sql, player!)).balance).toBe(50_000);
  });

  it('refuse un gain sans ligne du plan de versement (trigger 0045) et n’écrit rien', async () => {
    await expect(creditAgain(45_000)).rejects.toThrow(/sans ligne créditée du plan de versement/);
    expect(await transactions('tournament_prize')).toEqual([]);
    expect((await balances(database.sql, player!)).balance).toBe(5000);
  });

  it('refuse un crédit dont le montant diffère du plan et laisse le versement en attente', async () => {
    await seedPayout(45_000);
    await expect(payPrize(50_000)).rejects.toThrow(/crédit incohérent avec le plan/);
    expect(await transactions('tournament_prize')).toEqual([]);
    expect((await balances(database.sql, player!)).balance).toBe(5000);
    expect(await payout()).toEqual({ status: 'PENDING', wallet_transaction_id: null });
  });

  it('un achat après une réservation augmente le disponible', async () => {
    await reserve(5000);
    await fund(database.sql, player!, 2000);
    expect(await balances(database.sql, player!)).toEqual({
      balance: 7000,
      reserved: 5000,
      available: 2000,
    });
  });
});
