import type { SqlExecutor } from '../database/sql-client';
import type { UserId } from '../domain/users/user';
import type {
  ComplaintEvidenceRepository,
  ComplaintStatusFacts,
  GameFacts,
  PaymentFacts,
  TournamentFacts,
  WalletEntryFacts,
  WalletFacts,
  WithdrawalFacts,
} from './complaint-evidence.repository';

const num = (value: unknown) => Number(value ?? 0);
const numOrNull = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);
const iso = (value: Date | string) => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null) => (value === null ? null : iso(value));

interface GameRow {
  id: string;
  status: GameFacts['status'];
  started_at: Date | null;
  finished_at: Date | null;
  end_reason: string | null;
  winner_id: string | null;
  stake_amount: unknown;
  fled_at: Date | null;
  opponents: unknown;
  tournament_game: boolean;
  s_status: 'RESERVED' | 'SETTLED' | 'VOID' | null;
  s_outcome: string | null;
  net_gain: unknown;
  unit_amount: unknown;
  settled_at: Date | null;
}

// `g.state` (mains, plis) n'est JAMAIS lu : seules des colonnes de résultat.
const GAME_SELECT = `
  SELECT g.id, g.status, g.started_at, g.finished_at, g.end_reason, g.winner_id, g.stake_amount,
         gp.fled_at,
         (SELECT count(*) FROM game_players o WHERE o.game_id = g.id AND o.player_id <> gp.player_id)
           AS opponents,
         EXISTS (SELECT 1 FROM tournament_sessions ts WHERE ts.session_id = g.session_id)
           AS tournament_game,
         s.status AS s_status, s.outcome AS s_outcome, s.net_gain, s.unit_amount, s.settled_at
  FROM games g
  JOIN game_players gp ON gp.game_id = g.id
  LEFT JOIN game_settlements s ON s.game_id = g.id`;

interface WalletRow {
  id: string;
  kind: string;
  status: string;
  tokens: unknown;
  created_at: Date;
  completed_at: Date | null;
  failure_code: string | null;
  game_id: string | null;
}

function walletEntryOf(row: WalletRow): WalletEntryFacts {
  return {
    transactionId: row.id,
    kind: row.kind,
    status: row.status,
    tokens: num(row.tokens),
    createdAt: iso(row.created_at),
    completedAt: isoOrNull(row.completed_at),
    failureCode: row.failure_code,
    gameId: row.game_id,
  };
}

const PAYMENT_SELECT = `
  SELECT p.id, p.status, p.amount, p.currency, p.payment_method, p.created_at, p.completed_at,
         wt.status AS wt_status, wt.tokens
  FROM payments p
  JOIN wallet_transactions wt ON wt.id = p.wallet_transaction_id`;

interface PaymentRow {
  id: string;
  status: string;
  amount: unknown;
  currency: string;
  payment_method: string | null;
  created_at: Date;
  completed_at: Date | null;
  wt_status: string;
  tokens: unknown;
}

function paymentOf(row: PaymentRow): PaymentFacts {
  return {
    paymentId: row.id,
    status: row.status,
    amount: num(row.amount),
    currency: row.currency,
    operator: row.payment_method,
    createdAt: iso(row.created_at),
    completedAt: isoOrNull(row.completed_at),
    walletTransactionStatus: row.wt_status,
    tokens: num(row.tokens),
  };
}

const WITHDRAWAL_SELECT = `
  SELECT w.id, w.status, w.tokens, w.amount, w.operator, w.created_at, w.completed_at,
         w.failure_code, wt.status AS wt_status
  FROM withdrawals w
  JOIN wallet_transactions wt ON wt.id = w.wallet_transaction_id`;

interface WithdrawalRow {
  id: string;
  status: string;
  tokens: unknown;
  amount: unknown;
  operator: string;
  created_at: Date;
  completed_at: Date | null;
  failure_code: string | null;
  wt_status: string;
}

function withdrawalOf(row: WithdrawalRow): WithdrawalFacts {
  return {
    withdrawalId: row.id,
    status: row.status,
    tokens: num(row.tokens),
    amount: num(row.amount),
    operator: row.operator,
    createdAt: iso(row.created_at),
    completedAt: isoOrNull(row.completed_at),
    failureCode: row.failure_code,
    walletTransactionStatus: row.wt_status,
  };
}

const TOURNAMENT_SELECT = `
  SELECT t.id, t.status, t.starts_at, t.ends_at,
         r.status AS registration_status, r.registered_at, r.cancelled_at,
         res.rank, res.prize_amount, res.paid_at
  FROM tournaments t
  LEFT JOIN tournament_registrations r ON r.tournament_id = t.id AND r.user_id = $1
  LEFT JOIN tournament_results res ON res.tournament_id = t.id AND res.player_id = $1`;

interface TournamentRow {
  id: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
  registration_status: string | null;
  registered_at: Date | null;
  cancelled_at: Date | null;
  rank: number | null;
  prize_amount: unknown;
  paid_at: Date | null;
}

function tournamentOf(row: TournamentRow): TournamentFacts {
  return {
    tournamentId: row.id,
    tournamentStatus: row.status,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    registrationStatus: row.registration_status,
    registeredAt: isoOrNull(row.registered_at),
    cancelledAt: isoOrNull(row.cancelled_at),
    result:
      row.rank === null
        ? null
        : {
            rank: Number(row.rank),
            prizeAmount: num(row.prize_amount),
            paidAt: isoOrNull(row.paid_at),
          },
  };
}

/** Lectures bornées au joueur pour l'assistant et l'administration (D-114). */
export class PostgresComplaintEvidenceRepository implements ComplaintEvidenceRepository {
  constructor(private readonly sql: SqlExecutor) {}

  private async gameOf(userId: UserId, row: GameRow): Promise<GameFacts> {
    const { rows } = await this.sql.query<WalletRow>(
      `SELECT id, kind, status, tokens, created_at, completed_at, failure_code, game_id
       FROM wallet_transactions WHERE user_id = $1 AND game_id = $2 ORDER BY created_at, id`,
      [userId, row.id],
    );
    const finished = row.status === 'finished';
    return {
      gameId: row.id,
      status: row.status,
      startedAt: isoOrNull(row.started_at),
      finishedAt: isoOrNull(row.finished_at),
      endReason: row.end_reason,
      outcome: !finished
        ? null
        : row.winner_id === null
          ? 'NO_WINNER'
          : row.winner_id === userId
            ? 'WON'
            : 'LOST',
      playerFled: row.fled_at !== null,
      opponents: num(row.opponents),
      tournamentGame: row.tournament_game,
      stake: numOrNull(row.stake_amount),
      settlement: row.s_status
        ? {
            status: row.s_status,
            outcome: row.s_outcome,
            netGain: numOrNull(row.net_gain),
            unitAmount: numOrNull(row.unit_amount),
            settledAt: isoOrNull(row.settled_at),
          }
        : null,
      walletEntries: rows.map((r) => ({
        kind: r.kind,
        status: r.status,
        tokens: num(r.tokens),
        at: iso(r.created_at),
      })),
    };
  }

  async game(userId: UserId, gameId: string): Promise<GameFacts | null> {
    const { rows } = await this.sql.query<GameRow>(
      `${GAME_SELECT} WHERE g.id = $1 AND gp.player_id = $2`,
      [gameId, userId],
    );
    return rows[0] ? this.gameOf(userId, rows[0]) : null;
  }

  async recentGames(userId: UserId, limit: number): Promise<GameFacts[]> {
    const { rows } = await this.sql.query<GameRow>(
      `${GAME_SELECT} WHERE gp.player_id = $1 AND g.status <> 'waiting'
       ORDER BY COALESCE(g.started_at, g.created_at) DESC, g.id LIMIT $2`,
      [userId, limit],
    );
    return Promise.all(rows.map((row) => this.gameOf(userId, row)));
  }

  async wallet(userId: UserId, limit: number): Promise<WalletFacts> {
    const [balances, entries] = await Promise.all([
      this.sql.query<{ balance: unknown; reserved: unknown }>(
        'SELECT balance, reserved FROM wallets WHERE user_id = $1',
        [userId],
      ),
      this.sql.query<WalletRow>(
        `SELECT id, kind, status, tokens, created_at, completed_at, failure_code, game_id
         FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [userId, limit],
      ),
    ]);
    const balance = num(balances.rows[0]?.balance);
    const reserved = num(balances.rows[0]?.reserved);
    return {
      balance,
      reserved,
      available: balance - reserved,
      entries: entries.rows.map(walletEntryOf),
    };
  }

  async walletTransaction(userId: UserId, transactionId: string): Promise<WalletEntryFacts | null> {
    const { rows } = await this.sql.query<WalletRow>(
      `SELECT id, kind, status, tokens, created_at, completed_at, failure_code, game_id
       FROM wallet_transactions WHERE user_id = $1 AND id = $2`,
      [userId, transactionId],
    );
    return rows[0] ? walletEntryOf(rows[0]) : null;
  }

  async payment(userId: UserId, paymentId: string): Promise<PaymentFacts | null> {
    const { rows } = await this.sql.query<PaymentRow>(
      `${PAYMENT_SELECT} WHERE wt.user_id = $1 AND p.id = $2`,
      [userId, paymentId],
    );
    return rows[0] ? paymentOf(rows[0]) : null;
  }

  async recentPayments(userId: UserId, limit: number): Promise<PaymentFacts[]> {
    const { rows } = await this.sql.query<PaymentRow>(
      `${PAYMENT_SELECT} WHERE wt.user_id = $1 ORDER BY p.created_at DESC, p.id LIMIT $2`,
      [userId, limit],
    );
    return rows.map(paymentOf);
  }

  async withdrawal(userId: UserId, withdrawalId: string): Promise<WithdrawalFacts | null> {
    const { rows } = await this.sql.query<WithdrawalRow>(
      `${WITHDRAWAL_SELECT} WHERE w.user_id = $1 AND w.id = $2`,
      [userId, withdrawalId],
    );
    return rows[0] ? withdrawalOf(rows[0]) : null;
  }

  async recentWithdrawals(userId: UserId, limit: number): Promise<WithdrawalFacts[]> {
    const { rows } = await this.sql.query<WithdrawalRow>(
      `${WITHDRAWAL_SELECT} WHERE w.user_id = $1 ORDER BY w.created_at DESC, w.id LIMIT $2`,
      [userId, limit],
    );
    return rows.map(withdrawalOf);
  }

  async tournament(userId: UserId, tournamentId: string): Promise<TournamentFacts | null> {
    const { rows } = await this.sql.query<TournamentRow>(
      `${TOURNAMENT_SELECT}
       WHERE t.id = $2 AND (r.id IS NOT NULL OR res.player_id IS NOT NULL)`,
      [userId, tournamentId],
    );
    return rows[0] ? tournamentOf(rows[0]) : null;
  }

  async recentTournaments(userId: UserId, limit: number): Promise<TournamentFacts[]> {
    const { rows } = await this.sql.query<TournamentRow>(
      `${TOURNAMENT_SELECT}
       WHERE r.id IS NOT NULL OR res.player_id IS NOT NULL
       ORDER BY t.starts_at DESC, t.id LIMIT $2`,
      [userId, limit],
    );
    return rows.map(tournamentOf);
  }

  async complaintStatus(userId: UserId, reference: string): Promise<ComplaintStatusFacts | null> {
    const { rows } = await this.sql.query<{
      reference: string;
      status: string;
      category: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT reference, status, category, created_at, updated_at
       FROM complaints WHERE user_id = $1 AND reference = $2`,
      [userId, reference],
    );
    const row = rows[0];
    return row
      ? {
          reference: row.reference,
          status: row.status,
          category: row.category,
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
        }
      : null;
  }

  private async exists(text: string, params: unknown[]): Promise<boolean> {
    const { rows } = await this.sql.query<{ found: boolean }>(
      `SELECT EXISTS (${text}) AS found`,
      params,
    );
    return rows[0]?.found === true;
  }

  ownsPayment(userId: UserId, paymentId: string): Promise<boolean> {
    return this.exists(
      `SELECT 1 FROM payments p JOIN wallet_transactions wt ON wt.id = p.wallet_transaction_id
       WHERE p.id = $1 AND wt.user_id = $2`,
      [paymentId, userId],
    );
  }

  ownsWithdrawal(userId: UserId, withdrawalId: string): Promise<boolean> {
    return this.exists('SELECT 1 FROM withdrawals WHERE id = $1 AND user_id = $2', [
      withdrawalId,
      userId,
    ]);
  }

  ownsWalletTransaction(userId: UserId, transactionId: string): Promise<boolean> {
    return this.exists('SELECT 1 FROM wallet_transactions WHERE id = $1 AND user_id = $2', [
      transactionId,
      userId,
    ]);
  }

  playedGame(userId: UserId, gameId: string): Promise<boolean> {
    return this.exists('SELECT 1 FROM game_players WHERE game_id = $1 AND player_id = $2', [
      gameId,
      userId,
    ]);
  }

  joinedTournament(userId: UserId, tournamentId: string): Promise<boolean> {
    return this.exists(
      `SELECT 1 FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2
       UNION ALL
       SELECT 1 FROM tournament_results WHERE tournament_id = $1 AND player_id = $2`,
      [tournamentId, userId],
    );
  }
}
