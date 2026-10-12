import { randomUUID } from 'node:crypto';

import type { SqlExecutor } from '../database/sql-client';
import type { UserId } from '../domain/users/user';
import { InsufficientBalanceError } from '../domain/wallet/wallet';

/**
 * Réservations du compte de jeu (D-054) : extension du compte de jeu de D-040, PAS un second
 * portefeuille. Chaque fonction s'exécute DANS la transaction SQL de l'appelant (inscription,
 * démarrage, annulation, versement d'un gain) : l'opération du tournoi et le mouvement du
 * compte de jeu sont validés ou annulés ensemble.
 *
 * Invariants (garantis en base, migration 0021) :
 * - `wallets.reserved` = somme des réservations ACTIVE de TOURNOI ; `0 <= reserved <= balance` ;
 * - disponible = solde − réservé ;
 * - le solde ne change QUE par une ligne de `wallet_transactions` (capture, gain).
 *
 * Engagements de partie (D-080) : une réservation ACTIVE portant un `game_id` est un
 * ENGAGEMENT (2 × mise, perte maximale) et non un blocage visible : elle n'entre ni dans
 * `wallets.reserved`, ni dans le solde ou le disponible AFFICHÉS, qui restent identiques
 * pendant toute la partie. Elle est seulement déduite des contrôles de DÉPENSE faits sous le
 * verrou du portefeuille (`lockWalletBalances` : retrait, inscription à un tournoi, démarrage
 * d'une autre partie), pour que le perdant puisse toujours payer au règlement.
 */

export type ReservationStatus = 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED';

export interface WalletReservation {
  id: string;
  walletId: UserId;
  tournamentId: string;
  registrationId: string;
  amount: number;
  currency: 'XAF';
  status: ReservationStatus;
  captureTransactionId?: string;
  createdAt: Date;
  capturedAt?: Date;
  releasedAt?: Date;
}

export interface WalletBalances {
  balance: number;
  reserved: number;
  /** Solde utilisable : solde − réservé (− engagé, pour un contrôle de dépense). */
  available: number;
}

/** Montants lus SOUS verrou pour un contrôle de dépense (D-080). */
export interface LockedWalletBalances extends WalletBalances {
  /** Engagements des parties en cours (réservations ACTIVE avec `game_id`). */
  committed: number;
}

interface ReservationRow {
  id: string;
  wallet_id: UserId;
  tournament_id: string;
  registration_id: string;
  amount: string | number;
  currency: 'XAF';
  status: ReservationStatus;
  capture_transaction_id: string | null;
  created_at: Date;
  captured_at: Date | null;
  released_at: Date | null;
}

function toReservation(row: ReservationRow): WalletReservation {
  return {
    id: row.id,
    walletId: row.wallet_id,
    tournamentId: row.tournament_id,
    registrationId: row.registration_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    ...(row.capture_transaction_id && { captureTransactionId: row.capture_transaction_id }),
    createdAt: new Date(row.created_at),
    ...(row.captured_at && { capturedAt: new Date(row.captured_at) }),
    ...(row.released_at && { releasedAt: new Date(row.released_at) }),
  };
}

/**
 * Portefeuille créé s'il n'existe pas, puis verrouillé (`FOR UPDATE`) ; ses montants, pour un
 * contrôle de DÉPENSE : `available` = solde − réservé − engagements des parties en cours
 * (D-080). Les engagements sont lus après le verrou : une partie démarrée en même temps
 * (qui prend le même verrou pour s'engager) est vue, ou attend la fin de cette dépense.
 */
export async function lockWalletBalances(
  tx: SqlExecutor,
  userId: UserId,
  now: Date,
): Promise<LockedWalletBalances> {
  await tx.query(
    `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 0, $2, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, now.toISOString()],
  );
  const { rows } = await tx.query<{ balance: string | number; reserved: string | number }>(
    'SELECT balance, reserved FROM wallets WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  const balance = Number(rows[0]?.balance ?? 0);
  const reserved = Number(rows[0]?.reserved ?? 0);
  const committed = await readGameCommitments(tx, userId);
  return { balance, reserved, committed, available: balance - reserved - committed };
}

/** Somme des engagements ACTIVE des parties ordinaires du joueur (D-080). */
async function readGameCommitments(db: SqlExecutor, userId: UserId): Promise<number> {
  const { rows } = await db.query<{ committed: string | number }>(
    `SELECT COALESCE(sum(amount), 0) AS committed FROM wallet_reservations
     WHERE wallet_id = $1 AND game_id IS NOT NULL AND status = 'ACTIVE'`,
    [userId],
  );
  return Number(rows[0]?.committed ?? 0);
}

/**
 * Lecture sans verrou (affichage). Sans portefeuille : tout à 0. Les engagements de partie
 * n'y sont PAS déduits (D-080) : le solde affiché ne bouge pas pendant une partie.
 */
export async function readWalletBalances(db: SqlExecutor, userId: UserId): Promise<WalletBalances> {
  const { rows } = await db.query<{ balance: string | number; reserved: string | number }>(
    'SELECT balance, reserved FROM wallets WHERE user_id = $1',
    [userId],
  );
  const balance = Number(rows[0]?.balance ?? 0);
  const reserved = Number(rows[0]?.reserved ?? 0);
  return { balance, reserved, available: balance - reserved };
}

/**
 * Bloque `amount` sur le disponible du joueur (aucun débit). Lève InsufficientBalanceError
 * si le disponible ne suffit pas : l'appelant annule alors toute sa transaction.
 */
export async function reserveFunds(
  tx: SqlExecutor,
  input: {
    userId: UserId;
    tournamentId: string;
    registrationId: string;
    amount: number;
    now: Date;
  },
): Promise<WalletReservation> {
  const { available } = await lockWalletBalances(tx, input.userId, input.now);
  if (available < input.amount) {
    throw new InsufficientBalanceError(available, input.amount);
  }
  const id = randomUUID();
  const { rows } = await tx.query<ReservationRow>(
    `INSERT INTO wallet_reservations (id, wallet_id, tournament_id, registration_id, amount,
       currency, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'XAF', 'ACTIVE', $6)
     RETURNING *`,
    [
      id,
      input.userId,
      input.tournamentId,
      input.registrationId,
      input.amount,
      input.now.toISOString(),
    ],
  );
  await tx.query(
    'UPDATE wallets SET reserved = reserved + $2, updated_at = $3 WHERE user_id = $1',
    [input.userId, input.amount, input.now.toISOString()],
  );
  return toReservation(rows[0]!);
}

async function lockReservation(tx: SqlExecutor, id: string): Promise<WalletReservation | null> {
  const { rows } = await tx.query<ReservationRow>(
    'SELECT * FROM wallet_reservations WHERE id = $1 FOR UPDATE',
    [id],
  );
  return rows[0] ? toReservation(rows[0]) : null;
}

/**
 * Libère une réservation ACTIVE : le montant redevient disponible. Aucune transaction du
 * compte de jeu (rien n'avait été débité). Idempotente : une réservation déjà libérée ou
 * capturée est renvoyée telle quelle (`changed: false`).
 */
export async function releaseReservation(
  tx: SqlExecutor,
  reservationId: string,
  now: Date,
): Promise<{ reservation: WalletReservation; changed: boolean }> {
  const current = await lockReservation(tx, reservationId);
  if (!current) {
    throw new Error(`Réservation ${reservationId} introuvable`);
  }
  if (current.status !== 'ACTIVE') {
    return { reservation: current, changed: false };
  }
  // Ordre de verrouillage constant : réservation, puis portefeuille.
  await lockWalletBalances(tx, current.walletId, now);
  await tx.query(
    'UPDATE wallets SET reserved = reserved - $2, updated_at = $3 WHERE user_id = $1',
    [current.walletId, current.amount, now.toISOString()],
  );
  const { rows } = await tx.query<ReservationRow>(
    `UPDATE wallet_reservations SET status = 'RELEASED', released_at = $2 WHERE id = $1
     RETURNING *`,
    [reservationId, now.toISOString()],
  );
  return { reservation: toReservation(rows[0]!), changed: true };
}

/**
 * Capture une réservation ACTIVE : le montant devient un paiement DÉFINITIF (transaction
 * `tournament_entry`, solde et réservé diminués ensemble). Idempotente : déjà capturée →
 * renvoyée telle quelle ; libérée → erreur (jamais de débit sans réservation active).
 */
export async function captureReservation(
  tx: SqlExecutor,
  reservationId: string,
  now: Date,
): Promise<{ reservation: WalletReservation; changed: boolean }> {
  const current = await lockReservation(tx, reservationId);
  if (!current) {
    throw new Error(`Réservation ${reservationId} introuvable`);
  }
  if (current.status === 'CAPTURED') {
    return { reservation: current, changed: false };
  }
  if (current.status !== 'ACTIVE') {
    throw new ReservationNotActiveError(reservationId, current.status);
  }
  await lockWalletBalances(tx, current.walletId, now);
  let transactionId: string | null = null;
  if (current.amount > 0) {
    transactionId = randomUUID();
    await tx.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at)
       VALUES ($1, $2, 'tournament_entry', 'succeeded', $3, $4, $5, $5, $5)`,
      [
        transactionId,
        current.walletId,
        current.amount,
        `tournament-entry:${current.id}`,
        now.toISOString(),
      ],
    );
    // Débit définitif : le solde ET le réservé baissent ensemble (reserved <= balance tenu).
    await tx.query(
      `UPDATE wallets SET balance = balance - $2, reserved = reserved - $2, updated_at = $3
       WHERE user_id = $1`,
      [current.walletId, current.amount, now.toISOString()],
    );
  }
  const { rows } = await tx.query<ReservationRow>(
    `UPDATE wallet_reservations SET status = 'CAPTURED', captured_at = $2,
       capture_transaction_id = $3
     WHERE id = $1 RETURNING *`,
    [reservationId, now.toISOString(), transactionId],
  );
  return { reservation: toReservation(rows[0]!), changed: true };
}

/**
 * Crédite un gain de tournoi (transaction `tournament_prize`), une seule fois par clé
 * d'idempotence : une reprise renvoie la transaction existante sans recréditer.
 */
export async function creditTournamentPrize(
  tx: SqlExecutor,
  input: { userId: UserId; amount: number; idempotencyKey: string; now: Date },
): Promise<{ transactionId: string; credited: boolean }> {
  await lockWalletBalances(tx, input.userId, input.now);
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM wallet_transactions WHERE user_id = $1 AND idempotency_key = $2',
    [input.userId, input.idempotencyKey],
  );
  if (existing.rows[0]) {
    return { transactionId: existing.rows[0].id, credited: false };
  }
  const transactionId = randomUUID();
  await tx.query(
    `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
       created_at, updated_at, completed_at)
     VALUES ($1, $2, 'tournament_prize', 'succeeded', $3, $4, $5, $5, $5)`,
    [transactionId, input.userId, input.amount, input.idempotencyKey, input.now.toISOString()],
  );
  await tx.query('UPDATE wallets SET balance = balance + $2, updated_at = $3 WHERE user_id = $1', [
    input.userId,
    input.amount,
    input.now.toISOString(),
  ]);
  return { transactionId, credited: true };
}

/** Capture demandée sur une réservation libérée ou expirée : refusée, rien n'est débité. */
export class ReservationNotActiveError extends Error {
  constructor(
    readonly reservationId: string,
    readonly status: ReservationStatus,
  ) {
    super(`Réservation ${reservationId} non active (${status})`);
    this.name = 'ReservationNotActiveError';
  }
}
