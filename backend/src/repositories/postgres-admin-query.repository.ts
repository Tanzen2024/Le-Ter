import { LEDGER_SOURCES, type LedgerSource } from '../domain/platform-finance/platform-finance';
import type { SqlClient, SqlExecutor } from '../database/sql-client';
import { ADMIN_THRESHOLDS } from '../domain/admin/admin';
import type { GameType } from '../domain/game/game';
import type { PaymentStatus } from '../domain/payments/payment';
import { STARTED_STATUSES, type TournamentStatus } from '../domain/tournaments/tournament';
import type { UserRole, UserStatus } from '../domain/users/user';
import { activeSanctionSql } from './user-sanctions.sql';
import type {
  AdminGameDetail,
  AdminGamePlayer,
  AdminGameRow,
  AdminGameStatus,
  AdminPaymentDetail,
  AdminPaymentRow,
  AdminQueryRepository,
  AdminUserDetail,
  AdminUserRow,
  AdminWalletTransaction,
  DailyPoint,
  AttentionCounts,
  DashboardFacts,
  FinanceOverview,
  GameListQuery,
  LedgerEntry,
  LedgerKind,
  LedgerQuery,
  LedgerSummary,
  CommissionBreakdown,
  OrphanDepositRow,
  PaymentQuery,
  PaymentReconciliationRow,
  ReservationStatus,
  Period,
  TournamentLedgerFacts,
  TournamentReportRow,
  UserListQuery,
  UserSort,
  WalletKind,
  WalletStatus,
  WalletTransactionQuery,
} from './admin-query.repository';

/** Construit une clause WHERE paramétrée : aucune valeur n'est concaténée dans le SQL. */
class Where {
  readonly params: unknown[] = [];
  private readonly parts: string[] = [];

  /** `sql` contient un `?` par valeur (dans l'ordre). */
  add(sql: string, ...values: unknown[]): this {
    let text = sql;
    for (const value of values) {
      this.params.push(value);
      text = text.replace('?', `$${this.params.length}`);
    }
    this.parts.push(text);
    return this;
  }

  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  get clause(): string {
    return this.parts.length > 0 ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

const n = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const nOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const d = (value: unknown): Date => new Date(value as string);
const dOrNull = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);
const iso = (value: Date) => value.toISOString();

/** Motif LIKE littéral : `%`, `_` et `\` de la saisie ne sont pas des jokers. */
/** Les trois sources dans un ordre fixe, à 0 si aucune écriture (D-120). */
function allSources(
  rows: readonly { source: LedgerSource; count: number; amount: unknown }[],
): { source: LedgerSource; count: number; amount: number }[] {
  return LEDGER_SOURCES.map((source) => {
    const row = rows.find((r) => r.source === source);
    return { source, count: row?.count ?? 0, amount: n(row?.amount ?? 0) };
  });
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const USER_ORDER: Record<UserSort, string> = {
  created_desc: 'u.created_at DESC, u.id DESC',
  created_asc: 'u.created_at ASC, u.id ASC',
  username_asc: 'lower(u.username) ASC, u.id ASC',
};

/**
 * Libellé d'un tournoi : les tournois n'ont plus de nom (migration 0024) ; ils sont désignés
 * par leur date de début, dans leur fuseau.
 */
const TOURNAMENT_LABEL = `('Tournoi du ' || to_char(t.starts_at AT TIME ZONE t.timezone, 'DD/MM/YYYY HH24:MI'))`;

/** Parties « démarrées » : un joueur y a réellement joué (définition du joueur actif). */
const STARTED_GAME = `g.status IN ('in_progress', 'finished')`;

const USER_COLUMNS = `
  u.id, u.username, u.first_name, u.last_name, u.email, u.phone, u.phone_verified, u.role,
  u.status, u.created_at, u.updated_at,
  COALESCE(w.balance, 0) AS balance, COALESCE(w.reserved, 0) AS reserved,
  (SELECT count(*) FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.player_id = u.id AND ${STARTED_GAME})::int AS games_played,
  (SELECT max(g.created_at) FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.player_id = u.id) AS last_game_at`;

type UserRow = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  phone_verified: boolean;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
  balance: unknown;
  reserved: unknown;
  games_played: number;
  last_game_at: Date | null;
};

type Restrictions = Map<string, Pick<AdminUserRow, 'suspension' | 'chatRestriction'>>;

function userOf(row: UserRow, restrictions: Restrictions = new Map()): AdminUserRow {
  return {
    id: row.id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    phoneVerified: row.phone_verified,
    role: row.role,
    status: row.status,
    createdAt: d(row.created_at),
    balance: n(row.balance),
    reserved: n(row.reserved),
    gamesPlayed: n(row.games_played),
    lastGameAt: dOrNull(row.last_game_at),
    suspension: restrictions.get(row.id)?.suspension ?? null,
    chatRestriction: restrictions.get(row.id)?.chatRestriction ?? null,
  };
}

// Colonnes en liste blanche : `g.state` (mains, paquet, plis) n'est JAMAIS lu.
const GAME_COLUMNS = `
  g.id, g.game_type, g.garam_variant, g.status, g.session_id, g.max_players, g.stake_amount, g.created_at, g.started_at,
  g.finished_at, g.turn_deadline_at, g.turn_timed_out_at, g.end_reason, g.winner_id,
  g.replay_of_game_id,
  (SELECT r.id FROM games r WHERE r.replay_of_game_id = g.id) AS replayed_by_game_id,
  wu.username AS winner_username, ts.tournament_id, ${TOURNAMENT_LABEL} AS tournament_name,
  (SELECT COALESCE(json_agg(json_build_object(
            'playerId', gp.player_id, 'username', pu.username, 'seat', gp.seat,
            'joinedAt', gp.joined_at, 'fledAt', gp.fled_at) ORDER BY gp.seat), '[]'::json)
     FROM game_players gp JOIN users pu ON pu.id = gp.player_id
    WHERE gp.game_id = g.id) AS players`;

const GAME_FROM = `
  FROM games g
  LEFT JOIN users wu ON wu.id = g.winner_id
  LEFT JOIN tournament_sessions ts ON ts.session_id = g.session_id
  LEFT JOIN tournaments t ON t.id = ts.tournament_id`;

type GameRow = {
  id: string;
  game_type: GameType;
  garam_variant: number | null;
  status: AdminGameStatus;
  session_id: string;
  max_players: number;
  stake_amount: unknown;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  turn_deadline_at: Date | null;
  turn_timed_out_at: Date | null;
  end_reason: string | null;
  winner_id: string | null;
  replay_of_game_id: string | null;
  replayed_by_game_id: string | null;
  winner_username: string | null;
  tournament_id: string | null;
  tournament_name: string | null;
  players: unknown;
};

function playersOf(value: unknown): AdminGamePlayer[] {
  const list = (typeof value === 'string' ? JSON.parse(value) : value) as
    | {
        playerId: string;
        username: string;
        seat: number;
        joinedAt: string;
        fledAt: string | null;
      }[]
    | null;
  return (list ?? []).map((p) => ({
    playerId: p.playerId,
    username: p.username,
    seat: Number(p.seat),
    joinedAt: new Date(p.joinedAt).toISOString(),
    fledAt: p.fledAt ? new Date(p.fledAt).toISOString() : null,
  }));
}

function gameOf(row: GameRow): AdminGameRow {
  return {
    id: row.id,
    gameType: row.game_type,
    garamVariant: row.garam_variant === null ? null : n(row.garam_variant),
    status: row.status,
    sessionId: row.session_id,
    tournamentId: row.tournament_id,
    tournamentName: row.tournament_name,
    maxPlayers: n(row.max_players),
    stakeAmount: nOrNull(row.stake_amount),
    createdAt: d(row.created_at),
    startedAt: dOrNull(row.started_at),
    finishedAt: dOrNull(row.finished_at),
    turnDeadlineAt: dOrNull(row.turn_deadline_at),
    turnTimedOutAt: dOrNull(row.turn_timed_out_at),
    endReason: row.end_reason,
    winnerId: row.winner_id,
    winnerUsername: row.winner_username,
    replayOfGameId: row.replay_of_game_id,
    replayedByGameId: row.replayed_by_game_id,
    players: playersOf(row.players),
  };
}

const PAYMENT_COLUMNS = `
  p.id, p.merchant_transaction_id, p.provider_reference, p.amount, p.currency, p.status,
  p.provider_status, p.payment_method, p.created_at, p.updated_at, p.completed_at,
  p.wallet_transaction_id, wt.status AS wt_status, wt.tokens, wt.user_id, u.username`;

const PAYMENT_FROM = `
  FROM payments p
  JOIN wallet_transactions wt ON wt.id = p.wallet_transaction_id
  JOIN users u ON u.id = wt.user_id`;

type PaymentRow = {
  id: string;
  merchant_transaction_id: string;
  provider_reference: string | null;
  amount: unknown;
  currency: string;
  status: PaymentStatus;
  provider_status: string | null;
  payment_method: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  wallet_transaction_id: string;
  wt_status: WalletStatus;
  tokens: unknown;
  user_id: string;
  username: string;
};

function paymentOf(row: PaymentRow): AdminPaymentRow {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    merchantTransactionId: row.merchant_transaction_id,
    providerReference: row.provider_reference,
    amount: n(row.amount),
    currency: row.currency,
    status: row.status,
    providerStatus: row.provider_status,
    paymentMethod: row.payment_method,
    createdAt: d(row.created_at),
    updatedAt: d(row.updated_at),
    completedAt: dOrNull(row.completed_at),
    walletTransactionId: row.wallet_transaction_id,
    walletTransactionStatus: row.wt_status,
    tokens: n(row.tokens),
  };
}

/** Lectures de l'administration sur PostgreSQL. Aucune écriture. */
/**
 * Faits comptables des tournois (contrôles du compte de la plateforme, audit §8.5). Exportée :
 * la validation du plan de versement (D-112) l'exécute pour UN tournoi, dans sa transaction,
 * avec exactement les mêmes contrôles que la réconciliation de l'administration.
 */
export async function queryTournamentLedgerFacts(
  db: SqlExecutor,
  tournamentId?: string,
): Promise<TournamentLedgerFacts[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT t.id, ${TOURNAMENT_LABEL} AS name, t.status, t.started_at, t.entry_fee, t.participants,
       t.platform_fee_bps, t.gross_pool, t.platform_fee, t.prize_pool, t.unallocated_prize,
       (SELECT count(*) FROM wallet_reservations r
         WHERE r.tournament_id = t.id AND r.status = 'CAPTURED')::int AS captured_reservations,
       (SELECT COALESCE(sum(wt.tokens), 0) FROM wallet_reservations r
          JOIN wallet_transactions wt ON wt.id = r.capture_transaction_id
         WHERE r.tournament_id = t.id AND r.status = 'CAPTURED'
           AND wt.kind = 'tournament_entry' AND wt.status = 'succeeded')
         AS captured_entry_tokens,
       (SELECT count(*) FROM wallet_reservations r
          JOIN wallet_transactions wt ON wt.id = r.capture_transaction_id
         WHERE r.tournament_id = t.id AND r.status = 'CAPTURED'
           AND wt.kind = 'tournament_entry' AND wt.status = 'succeeded')::int
         AS captured_entry_transactions,
       (SELECT l.amount FROM platform_ledger l
         WHERE l.tournament_id = t.id AND l.kind = 'TOURNAMENT_PLATFORM_FEE') AS fee_entry,
       (SELECT l.amount FROM platform_ledger l
         WHERE l.tournament_id = t.id AND l.kind = 'UNALLOCATED_PRIZE') AS unallocated_entry,
       (SELECT count(*) FROM tournament_results tr WHERE tr.tournament_id = t.id)::int
         AS results_count,
       (SELECT COALESCE(sum(tr.prize_amount), 0) FROM tournament_results tr
         WHERE tr.tournament_id = t.id) AS results_prize_total,
       (SELECT count(*) FROM tournament_results tr
          LEFT JOIN wallet_transactions wt ON wt.id = tr.prize_transaction_id
         WHERE tr.tournament_id = t.id AND tr.prize_amount > 0
           AND (wt.id IS NULL OR wt.kind <> 'tournament_prize' OR wt.status <> 'succeeded'
                OR wt.tokens <> tr.prize_amount))::int AS unpaid_prizes,
       (SELECT COALESCE(json_agg(json_build_object('rank', pr.rank, 'shareBps', pr.share_bps)
                 ORDER BY pr.rank), '[]'::json)
          FROM tournament_prize_rules pr WHERE pr.tournament_id = t.id) AS prize_rules
     FROM tournaments t
     WHERE (t.started_at IS NOT NULL OR t.status = ANY($1::text[])
        OR EXISTS (SELECT 1 FROM platform_ledger l WHERE l.tournament_id = t.id))
       AND ($2::uuid IS NULL OR t.id = $2)
     ORDER BY t.starts_at DESC`,
    [[...STARTED_STATUSES], tournamentId ?? null],
  );
  return rows.map((row) => {
    const rules = (
      typeof row.prize_rules === 'string' ? JSON.parse(row.prize_rules) : row.prize_rules
    ) as { rank: number; shareBps: number }[] | null;
    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as TournamentStatus,
      startedAt: dOrNull(row.started_at),
      entryFee: n(row.entry_fee),
      participants: nOrNull(row.participants),
      platformFeeBps: nOrNull(row.platform_fee_bps),
      grossPool: nOrNull(row.gross_pool),
      platformFee: nOrNull(row.platform_fee),
      prizePool: nOrNull(row.prize_pool),
      unallocatedPrize: nOrNull(row.unallocated_prize),
      capturedReservations: n(row.captured_reservations),
      capturedEntryTokens: n(row.captured_entry_tokens),
      capturedEntryTransactions: n(row.captured_entry_transactions),
      feeEntryAmount: nOrNull(row.fee_entry),
      unallocatedEntryAmount: nOrNull(row.unallocated_entry),
      resultsCount: n(row.results_count),
      resultsPrizeTotal: n(row.results_prize_total),
      unpaidPrizes: n(row.unpaid_prizes),
      prizeRules: (rules ?? []).map((r) => ({
        rank: Number(r.rank),
        shareBps: Number(r.shareBps),
      })),
    };
  });
}

export class PostgresAdminQueryRepository implements AdminQueryRepository {
  constructor(private readonly db: SqlClient) {}

  private async page<Row extends object>(
    select: string,
    from: string,
    where: Where,
    order: string,
    page: { page: number; limit: number },
  ): Promise<{ total: number; rows: Row[] }> {
    const count = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n ${from} ${where.clause}`,
      where.params,
    );
    const limit = where.param(page.limit);
    const offset = where.param((page.page - 1) * page.limit);
    const { rows } = await this.db.query<Row>(
      `SELECT ${select} ${from} ${where.clause} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      where.params,
    );
    return { total: n(count.rows[0]?.n), rows };
  }

  // --- Joueurs --------------------------------------------------------------------------------

  /**
   * Suspensions et restrictions du chat EN COURS à `now` (heure du serveur) des comptes
   * listés (D-079) : une requête pour toute la page.
   */
  private async restrictionsOf(ids: string[], now: Date): Promise<Restrictions> {
    const map: Restrictions = new Map();
    if (ids.length === 0) return map;
    const { rows } = await this.db.query<{
      user_id: string;
      kind: 'SUSPENSION' | 'CHAT_RESTRICTION';
      indefinite: boolean;
      ends_at: Date | null;
    }>(
      `SELECT s.user_id, s.kind, bool_or(s.ends_at IS NULL) AS indefinite, max(s.ends_at) AS ends_at
       FROM user_sanctions s
       WHERE s.user_id = ANY($1::uuid[]) AND s.kind IN ('SUSPENSION', 'CHAT_RESTRICTION')
         AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > $2)
       GROUP BY s.user_id, s.kind`,
      [ids, iso(now)],
    );
    for (const row of rows) {
      const entry = map.get(row.user_id) ?? { suspension: null, chatRestriction: null };
      const value = { endsAt: row.indefinite ? null : dOrNull(row.ends_at) };
      if (row.kind === 'SUSPENSION') entry.suspension = value;
      else entry.chatRestriction = value;
      map.set(row.user_id, entry);
    }
    return map;
  }

  async listUsers(query: UserListQuery, now: Date) {
    const where = new Where();
    if (query.q) {
      const like = likePattern(query.q);
      where.add(
        `(u.username ILIKE ? OR u.email ILIKE ? OR u.phone LIKE ? OR u.id::text = ?
          OR (u.first_name || ' ' || u.last_name) ILIKE ?)`,
        like,
        like,
        like,
        query.q.toLowerCase(),
        like,
      );
    }
    if (query.status === 'suspended') {
      where.add(activeSanctionSql('u.id', 'SUSPENSION', '?::timestamptz'), iso(now));
    } else if (query.status) {
      where.add('u.status = ?', query.status);
    }
    if (query.role) where.add('u.role = ?', query.role);
    const { total, rows } = await this.page<UserRow>(
      USER_COLUMNS,
      'FROM users u LEFT JOIN wallets w ON w.user_id = u.id',
      where,
      USER_ORDER[query.sort],
      query,
    );
    const restrictions = await this.restrictionsOf(
      rows.map((r) => r.id),
      now,
    );
    return { total, items: rows.map((r) => userOf(r, restrictions)) };
  }

  async findUser(id: string, now: Date): Promise<AdminUserDetail | null> {
    const { rows } = await this.db.query<
      UserRow & {
        games_won_ter: number;
        games_won_garam: number;
        active_game_id: string | null;
        active_session_id: string | null;
        registrations: number;
        payments_total: number;
        payments_succeeded: number;
        payments_succeeded_amount: unknown;
        payments_pending: number;
      }
    >(
      `SELECT ${USER_COLUMNS},
         (SELECT count(*) FROM games g WHERE g.winner_id = u.id AND g.game_type = 'TER')::int
           AS games_won_ter,
         (SELECT count(*) FROM games g WHERE g.winner_id = u.id AND g.game_type = 'GARAM')::int
           AS games_won_garam,
         (SELECT gp.game_id FROM game_players gp WHERE gp.player_id = u.id AND gp.active
           LIMIT 1) AS active_game_id,
         (SELECT sp.session_id FROM session_players sp JOIN sessions s ON s.id = sp.session_id
           WHERE sp.player_id = u.id AND sp.active AND s.status = 'open' LIMIT 1)
           AS active_session_id,
         (SELECT count(*) FROM tournament_registrations r
           WHERE r.user_id = u.id AND r.status = 'REGISTERED')::int AS registrations,
         (SELECT count(*) FROM payments p JOIN wallet_transactions wt
            ON wt.id = p.wallet_transaction_id WHERE wt.user_id = u.id)::int AS payments_total,
         (SELECT count(*) FROM payments p JOIN wallet_transactions wt
            ON wt.id = p.wallet_transaction_id
           WHERE wt.user_id = u.id AND p.status = 'SUCCESS')::int AS payments_succeeded,
         (SELECT COALESCE(sum(p.amount), 0) FROM payments p JOIN wallet_transactions wt
            ON wt.id = p.wallet_transaction_id
           WHERE wt.user_id = u.id AND p.status = 'SUCCESS') AS payments_succeeded_amount,
         (SELECT count(*) FROM payments p JOIN wallet_transactions wt
            ON wt.id = p.wallet_transaction_id
           WHERE wt.user_id = u.id AND p.status = 'PENDING')::int AS payments_pending
       FROM users u LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...userOf(row, await this.restrictionsOf([row.id], now)),
      updatedAt: d(row.updated_at),
      gamesWon: { fapFap: n(row.games_won_ter), garamTia: n(row.games_won_garam) },
      activeGameId: row.active_game_id,
      activeSessionId: row.active_session_id,
      tournamentRegistrations: n(row.registrations),
      payments: {
        total: n(row.payments_total),
        succeeded: n(row.payments_succeeded),
        succeededAmount: n(row.payments_succeeded_amount),
        pending: n(row.payments_pending),
      },
    };
  }

  // --- Parties --------------------------------------------------------------------------------

  async listGames(query: GameListQuery, now: Date) {
    const where = new Where();
    if (query.status) where.add('g.status = ?', query.status);
    if (query.from) where.add('g.created_at >= ?', iso(query.from));
    if (query.to) where.add('g.created_at < ?', iso(query.to));
    if (query.gameId) where.add('g.id = ?', query.gameId);
    if (query.sessionId) where.add('g.session_id = ?', query.sessionId);
    if (query.tournamentId) where.add('ts.tournament_id = ?', query.tournamentId);
    if (query.gameType) where.add('g.game_type = ?', query.gameType);
    if (query.playerId) {
      where.add(
        'EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.player_id = ?)',
        query.playerId,
      );
    }
    if (query.anomaly === 'STALE_WAITING') {
      where.add(
        `g.status = 'waiting' AND g.created_at < ?::timestamptz - make_interval(hours => ?)`,
        iso(now),
        ADMIN_THRESHOLDS.staleWaitingGameHours,
      );
    } else if (query.anomaly === 'LONG_RUNNING') {
      where.add(
        `g.status = 'in_progress' AND g.started_at < ?::timestamptz - make_interval(mins => ?)`,
        iso(now),
        ADMIN_THRESHOLDS.longRunningGameMinutes,
      );
    } else if (query.anomaly === 'OVERDUE_TURN') {
      where.add(
        `g.status = 'in_progress'
         AND g.turn_deadline_at < ?::timestamptz - make_interval(secs => ?)`,
        iso(now),
        ADMIN_THRESHOLDS.overdueTurnSeconds,
      );
    }
    const { total, rows } = await this.page<GameRow>(
      GAME_COLUMNS,
      GAME_FROM,
      where,
      'g.created_at DESC, g.id DESC',
      query,
    );
    return { total, items: rows.map(gameOf) };
  }

  async findGame(id: string): Promise<AdminGameDetail | null> {
    const { rows } = await this.db.query<
      GameRow & {
        s_status: string;
        s_name: string | null;
        s_max_players: number | null;
        s_creator: string | null;
        s_detection: boolean;
        s_games: number;
        creator_username: string | null;
        first_player_username: string | null;
        chat_messages: number;
        detection_alerts: number;
      }
    >(
      `SELECT ${GAME_COLUMNS},
         s.status AS s_status, s.name AS s_name, s.max_players AS s_max_players,
         sc.username AS s_creator, s.suspicion_detection_enabled AS s_detection,
         (SELECT count(*) FROM games sg WHERE sg.session_id = s.id)::int AS s_games,
         cu.username AS creator_username, fu.username AS first_player_username,
         (SELECT count(*) FROM game_chat_messages m WHERE m.game_id = g.id)::int AS chat_messages,
         (SELECT count(*) FROM detection_alerts a WHERE a.game_id = g.id)::int AS detection_alerts
       ${GAME_FROM}
       JOIN sessions s ON s.id = g.session_id
       LEFT JOIN users sc ON sc.id = s.creator_id
       LEFT JOIN users cu ON cu.id = g.creator_id
       LEFT JOIN users fu ON fu.id = g.first_player_id
       WHERE g.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...gameOf(row),
      session: {
        id: row.session_id,
        status: row.s_status,
        name: row.s_name,
        maxPlayers: nOrNull(row.s_max_players),
        creatorUsername: row.s_creator,
        suspicionDetectionEnabled: row.s_detection,
        gamesCount: n(row.s_games),
      },
      creatorUsername: row.creator_username,
      firstPlayerUsername: row.first_player_username,
      chatMessages: n(row.chat_messages),
      detectionAlerts: n(row.detection_alerts),
    };
  }

  // --- Finances -------------------------------------------------------------------------------

  async listWalletTransactions(query: WalletTransactionQuery) {
    const where = new Where();
    if (query.kind) where.add('wt.kind = ?', query.kind);
    if (query.status) where.add('wt.status = ?', query.status);
    if (query.userId) where.add('wt.user_id = ?', query.userId);
    if (query.from) where.add('wt.created_at >= ?', iso(query.from));
    if (query.to) where.add('wt.created_at < ?', iso(query.to));
    if (query.q) {
      where.add(
        `(wt.id::text = ? OR wt.provider_reference = ? OR p.merchant_transaction_id = ?
          OR p.provider_reference = ? OR p.id::text = ?)`,
        query.q.toLowerCase(),
        query.q,
        query.q,
        query.q,
        query.q.toLowerCase(),
      );
    }
    const { total, rows } = await this.page<{
      id: string;
      user_id: string;
      username: string;
      kind: WalletKind;
      status: WalletStatus;
      tokens: unknown;
      failure_code: string | null;
      provider_reference: string | null;
      created_at: Date;
      completed_at: Date | null;
      payment_id: string | null;
      tournament_id: string | null;
    }>(
      `wt.id, wt.user_id, u.username, wt.kind, wt.status, wt.tokens, wt.failure_code,
       wt.provider_reference, wt.created_at, wt.completed_at, p.id AS payment_id,
       COALESCE(r.tournament_id, tr.tournament_id) AS tournament_id`,
      `FROM wallet_transactions wt
       JOIN users u ON u.id = wt.user_id
       LEFT JOIN payments p ON p.wallet_transaction_id = wt.id
       LEFT JOIN wallet_reservations r ON r.capture_transaction_id = wt.id
       LEFT JOIN tournament_results tr ON tr.prize_transaction_id = wt.id`,
      where,
      'wt.created_at DESC, wt.id DESC',
      query,
    );
    return {
      total,
      items: rows.map((row): AdminWalletTransaction => ({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        kind: row.kind,
        status: row.status,
        tokens: n(row.tokens),
        failureCode: row.failure_code,
        providerReference: row.provider_reference,
        createdAt: d(row.created_at),
        completedAt: dOrNull(row.completed_at),
        paymentId: row.payment_id,
        tournamentId: row.tournament_id,
      })),
    };
  }

  async listPayments(query: PaymentQuery) {
    const where = new Where();
    if (query.status) where.add('p.status = ?', query.status);
    if (query.userId) where.add('wt.user_id = ?', query.userId);
    if (query.from) where.add('p.created_at >= ?', iso(query.from));
    if (query.to) where.add('p.created_at < ?', iso(query.to));
    if (query.minAmount !== undefined) where.add('p.amount >= ?', query.minAmount);
    if (query.maxAmount !== undefined) where.add('p.amount <= ?', query.maxAmount);
    if (query.q) {
      where.add(
        '(p.id::text = ? OR p.merchant_transaction_id = ? OR p.provider_reference = ?)',
        query.q.toLowerCase(),
        query.q,
        query.q,
      );
    }
    const { total, rows } = await this.page<PaymentRow>(
      PAYMENT_COLUMNS,
      PAYMENT_FROM,
      where,
      'p.created_at DESC, p.id DESC',
      query,
    );
    return { total, items: rows.map(paymentOf) };
  }

  async findPayment(id: string): Promise<AdminPaymentDetail | null> {
    const { rows } = await this.db.query<
      PaymentRow & { failure: string | null; anomaly: string | null }
    >(
      `SELECT ${PAYMENT_COLUMNS},
         p.metadata ->> 'failure' AS failure, p.metadata ->> 'anomaly' AS anomaly
       ${PAYMENT_FROM} WHERE p.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...paymentOf(row),
      initializationFailure: row.failure,
      settlementAnomaly: row.anomaly,
    };
  }

  async financeOverview(period: Period): Promise<FinanceOverview> {
    const params = [iso(period.from), iso(period.to)];
    const purchases = await this.db.query<{ status: string; count: number; amount: unknown }>(
      `SELECT status, count(*)::int AS count, COALESCE(sum(amount), 0) AS amount
       FROM payments WHERE created_at >= $1 AND created_at < $2
       GROUP BY status ORDER BY status`,
      params,
    );
    // `payments.wallet_transaction_id` est UNIQUE : la jointure ne multiplie aucune ligne.
    // Un achat sans paiement (refusé avant l'appel à CinetPay, ex. montant hors barème) n'est
    // pas un paiement CinetPay : il est compté à part, jamais avec les achats du fournisseur.
    const movements = await this.db.query<{
      kind: WalletKind;
      status: WalletStatus;
      without_payment: boolean;
      count: number;
      tokens: unknown;
    }>(
      `SELECT wt.kind, wt.status,
              (wt.kind = 'deposit' AND p.id IS NULL) AS without_payment,
              count(*)::int AS count, COALESCE(sum(wt.tokens), 0) AS tokens
       FROM wallet_transactions wt
       LEFT JOIN payments p ON p.wallet_transaction_id = wt.id
       WHERE wt.created_at >= $1 AND wt.created_at < $2
       GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
      params,
    );
    const reservations = await this.db.query<{
      status: ReservationStatus;
      count: number;
      amount: unknown;
    }>(
      // Partie (D-074) : seule la mise due est capturée (`captured_amount`), le reste libéré.
      `SELECT status, count(*)::int AS count,
              COALESCE(sum(CASE WHEN status = 'CAPTURED' THEN COALESCE(captured_amount, amount)
                                ELSE amount END), 0) AS amount
       FROM wallet_reservations WHERE created_at >= $1 AND created_at < $2
       GROUP BY status ORDER BY status`,
      params,
    );
    const liabilities = await this.db.query<{
      wallets: number;
      balance: unknown;
      reserved: unknown;
    }>(
      `SELECT count(*)::int AS wallets, COALESCE(sum(balance), 0) AS balance,
              COALESCE(sum(reserved), 0) AS reserved
       FROM wallets`,
    );
    const revenue = await this.db.query<{ kind: string; count: number; amount: unknown }>(
      `SELECT kind, count(*)::int AS count, COALESCE(sum(amount), 0) AS amount
       FROM platform_ledger WHERE created_at >= $1 AND created_at < $2
       GROUP BY kind ORDER BY kind`,
      params,
    );
    const l = liabilities.rows[0];
    return {
      purchases: purchases.rows.map((r) => ({
        status: r.status,
        count: r.count,
        amount: n(r.amount),
      })),
      walletMovements: movements.rows.map((r) => ({
        kind: r.kind,
        status: r.status,
        withoutPayment: r.without_payment,
        count: r.count,
        tokens: n(r.tokens),
      })),
      reservations: reservations.rows.map((r) => ({
        status: r.status,
        count: r.count,
        amount: n(r.amount),
      })),
      liabilities: { wallets: n(l?.wallets), balance: n(l?.balance), reserved: n(l?.reserved) },
      platformRevenue: revenue.rows.map((r) => ({
        kind: r.kind,
        count: r.count,
        amount: n(r.amount),
      })),
    };
  }

  // --- Compte financier de la plateforme ------------------------------------------------------

  async ledgerSummary(period?: Period): Promise<LedgerSummary> {
    const where = new Where();
    if (period) where.add('created_at >= ? AND created_at < ?', iso(period.from), iso(period.to));
    const byKind = await this.db.query<{ kind: LedgerKind; count: number; amount: unknown }>(
      `SELECT kind, count(*)::int AS count, COALESCE(sum(amount), 0) AS amount
       FROM platform_ledger ${where.clause} GROUP BY kind ORDER BY kind`,
      where.params,
    );
    const bounds = await this.db.query<{ first: Date | null; last: Date | null }>(
      `SELECT min(created_at) AS first, max(created_at) AS last FROM platform_ledger ${where.clause}`,
      where.params,
    );
    const bySource = await this.db.query<{ source: LedgerSource; count: number; amount: unknown }>(
      `SELECT source, count(*)::int AS count, COALESCE(sum(amount), 0) AS amount
       FROM platform_ledger ${where.clause} GROUP BY source`,
      where.params,
    );
    const kinds = byKind.rows.map((r) => ({ kind: r.kind, count: r.count, amount: n(r.amount) }));
    return {
      byKind: kinds,
      bySource: allSources(bySource.rows),
      total: kinds.reduce((sum, k) => sum + k.amount, 0),
      entries: kinds.reduce((sum, k) => sum + k.count, 0),
      firstEntryAt: dOrNull(bounds.rows[0]?.first),
      lastEntryAt: dOrNull(bounds.rows[0]?.last),
      currency: 'XAF',
    };
  }

  async listLedger(query: LedgerQuery) {
    const where = new Where();
    if (query.kind) where.add('l.kind = ?', query.kind);
    if (query.source) where.add('l.source = ?', query.source);
    if (query.tournamentId) where.add('l.tournament_id = ?', query.tournamentId);
    if (query.q) {
      // Référence (préfixe d'identifiant) de l'écriture, de la partie, de sa session ou du
      // tournoi ; ou nom du tournoi.
      const prefix = `${likePattern(query.q.toLowerCase()).replace(/^%|%$/g, '')}%`;
      where.add(
        `(l.id::text LIKE ? OR l.game_id::text LIKE ? OR g.session_id::text LIKE ?
          OR l.tournament_id::text LIKE ? OR ${TOURNAMENT_LABEL} ILIKE ?)`,
        prefix,
        prefix,
        prefix,
        prefix,
        likePattern(query.q),
      );
    }
    if (query.from) where.add('l.created_at >= ?', iso(query.from));
    if (query.to) where.add('l.created_at < ?', iso(query.to));
    const { total, rows } = await this.page<{
      id: string;
      tournament_id: string | null;
      name: string | null;
      game_id: string | null;
      session_id: string | null;
      kind: LedgerKind;
      source: LedgerSource;
      amount: unknown;
      fee_bps: number | null;
      currency: string;
      created_at: Date;
      participants: number | null;
      gross_pool: unknown;
    }>(
      `l.id, l.tournament_id, CASE WHEN t.id IS NULL THEN NULL ELSE ${TOURNAMENT_LABEL} END AS name,
       l.game_id, g.session_id, l.kind, l.source, l.amount, l.fee_bps, l.currency, l.created_at,
       COALESCE(t.participants, gs.participants) AS participants,
       COALESCE(t.gross_pool, gs.gross_amount) AS gross_pool`,
      `FROM platform_ledger l
       LEFT JOIN tournaments t ON t.id = l.tournament_id
       LEFT JOIN game_settlements gs ON gs.game_id = l.game_id
       LEFT JOIN games g ON g.id = l.game_id`,
      where,
      'l.created_at DESC, l.id DESC',
      query,
    );
    return {
      total,
      items: rows.map((row): LedgerEntry => ({
        id: row.id,
        tournamentId: row.tournament_id,
        tournamentName: row.name,
        gameId: row.game_id,
        sessionId: row.session_id,
        kind: row.kind,
        source: row.source,
        amount: n(row.amount),
        feeBps: nOrNull(row.fee_bps),
        currency: row.currency,
        createdAt: d(row.created_at),
        participants: nOrNull(row.participants),
        grossPool: nOrNull(row.gross_pool),
      })),
    };
  }

  // --- Rapprochement --------------------------------------------------------------------------

  async paymentReconciliation(options: {
    now: Date;
    staleMinutes: number;
    depositLimits: { min: number; max: number };
    tokensPerUnit: number;
    limit: number;
  }): Promise<PaymentReconciliationRow[]> {
    const { rows } = await this.db.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
       WHERE (p.status = 'SUCCESS' AND wt.status <> 'succeeded')
          OR (p.status IN ('FAILED', 'EXPIRED') AND wt.status <> 'failed')
          OR (p.status = 'PENDING' AND wt.status <> 'pending')
          OR p.amount * $3 <> wt.tokens
          OR p.amount < $4 OR p.amount > $6
          OR (p.status = 'PENDING'
              AND p.created_at < $1::timestamptz - make_interval(mins => $2))
       ORDER BY p.created_at DESC
       LIMIT $5`,
      [
        iso(options.now),
        options.staleMinutes,
        options.tokensPerUnit,
        options.depositLimits.min,
        options.limit,
        options.depositLimits.max,
      ],
    );
    return rows.map((row) => {
      const p = paymentOf(row);
      return {
        paymentId: p.id,
        merchantTransactionId: p.merchantTransactionId,
        providerReference: p.providerReference,
        userId: p.userId,
        username: p.username,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        createdAt: p.createdAt,
        walletTransactionId: p.walletTransactionId,
        walletTransactionStatus: p.walletTransactionStatus,
        tokens: p.tokens,
      };
    });
  }

  async orphanDeposits(limit: number): Promise<OrphanDepositRow[]> {
    const { rows } = await this.db.query<{
      id: string;
      user_id: string;
      username: string;
      tokens: unknown;
      status: WalletStatus;
      created_at: Date;
    }>(
      `SELECT wt.id, wt.user_id, u.username, wt.tokens, wt.status, wt.created_at
       FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
       WHERE wt.kind = 'deposit'
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.wallet_transaction_id = wt.id)
       ORDER BY wt.created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      walletTransactionId: row.id,
      userId: row.user_id,
      username: row.username,
      tokens: n(row.tokens),
      status: row.status,
      createdAt: d(row.created_at),
    }));
  }

  tournamentLedgerFacts(): Promise<TournamentLedgerFacts[]> {
    return queryTournamentLedgerFacts(this.db);
  }

  // --- Tableau de bord et rapports ------------------------------------------------------------

  async commissionsBySource(period: Period, source?: LedgerSource): Promise<CommissionBreakdown> {
    const where = new Where();
    where.add('created_at >= ? AND created_at < ?', iso(period.from), iso(period.to));
    if (source) where.add('source = ?', source);
    const { rows } = await this.db.query<{ source: LedgerSource; count: number; amount: unknown }>(
      `SELECT source, count(*)::int AS count, COALESCE(sum(amount), 0) AS amount
       FROM platform_ledger ${where.clause} GROUP BY source`,
      where.params,
    );
    const bySource = allSources(rows);
    return {
      total: bySource.reduce((sum, s) => sum + s.amount, 0),
      entries: bySource.reduce((sum, s) => sum + s.count, 0),
      bySource,
    };
  }

  async dashboard(period: Period, now: Date): Promise<DashboardFacts> {
    const params = [iso(period.from), iso(period.to)];
    const players = await this.db.query<{
      total: number;
      new_in_period: number;
      admins: number;
      active: number;
    }>(
      `SELECT
         (SELECT count(*) FROM users WHERE role = 'user')::int AS total,
         (SELECT count(*) FROM users WHERE role = 'user'
            AND created_at >= $1 AND created_at < $2)::int AS new_in_period,
         (SELECT count(*) FROM users WHERE role = 'admin')::int AS admins,
         (SELECT count(DISTINCT gp.player_id) FROM game_players gp JOIN games g ON g.id = gp.game_id
           WHERE g.created_at >= $1 AND g.created_at < $2 AND ${STARTED_GAME})::int AS active`,
      params,
    );
    const games = await this.db.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count FROM games
       WHERE created_at >= $1 AND created_at < $2 GROUP BY status ORDER BY status`,
      params,
    );
    const live = await this.db.query<{ waiting: number; in_progress: number; finished: number }>(
      `SELECT
         (SELECT count(*) FROM games WHERE status = 'waiting')::int AS waiting,
         (SELECT count(*) FROM games WHERE status = 'in_progress')::int AS in_progress,
         (SELECT count(*) FROM games WHERE status = 'finished'
            AND finished_at >= $1 AND finished_at < $2)::int AS finished`,
      params,
    );
    const tournaments = await this.db.query<{ status: TournamentStatus; count: number }>(
      'SELECT status, count(*)::int AS count FROM tournaments GROUP BY status ORDER BY status',
    );
    const payments = await this.db.query<{ status: string; count: number; amount: unknown }>(
      `SELECT status, count(*)::int AS count, COALESCE(sum(amount), 0) AS amount FROM payments
       WHERE created_at >= $1 AND created_at < $2 GROUP BY status ORDER BY status`,
      params,
    );
    const revenue = await this.db.query<{ amount: unknown }>(
      `SELECT COALESCE(sum(amount), 0) AS amount FROM platform_ledger
       WHERE created_at >= $1 AND created_at < $2`,
      params,
    );
    const p = players.rows[0];
    const lv = live.rows[0];
    return {
      players: {
        total: n(p?.total),
        newInPeriod: n(p?.new_in_period),
        active: n(p?.active),
        admins: n(p?.admins),
      },
      games: {
        waiting: n(lv?.waiting),
        inProgress: n(lv?.in_progress),
        createdInPeriod: games.rows.reduce((sum, r) => sum + r.count, 0),
        finishedInPeriod: n(lv?.finished),
        byStatusInPeriod: games.rows,
      },
      tournaments: tournaments.rows,
      payments: payments.rows.map((r) => ({
        status: r.status,
        count: r.count,
        amount: n(r.amount),
      })),
      platformRevenue: n(revenue.rows[0]?.amount),
      alerts: await this.attention(now),
    };
  }

  async attention(now: Date): Promise<AttentionCounts> {
    const alerts = await this.db.query<{
      new_alerts: number;
      pending_approvals: number;
      stale_payments: number;
      overdue_turns: number;
      pending_complaints: number;
    }>(
      `SELECT
         (SELECT count(*) FROM detection_alerts WHERE status = 'NEW')::int AS new_alerts,
         (SELECT count(*) FROM tournaments WHERE status = 'PENDING_APPROVAL')::int
           AS pending_approvals,
         (SELECT count(*) FROM payments WHERE status = 'PENDING'
            AND created_at < $1::timestamptz - make_interval(mins => $2))::int AS stale_payments,
         (SELECT count(*) FROM games WHERE status = 'in_progress'
            AND turn_deadline_at < $1::timestamptz - make_interval(secs => $3))::int
           AS overdue_turns,
         (SELECT count(*) FROM complaints
            WHERE status IN ('OPEN', 'AI_ANALYSIS', 'IN_REVIEW'))::int AS pending_complaints`,
      [iso(now), ADMIN_THRESHOLDS.stalePendingPaymentMinutes, ADMIN_THRESHOLDS.overdueTurnSeconds],
    );
    const a = alerts.rows[0];
    return {
      newDetectionAlerts: n(a?.new_alerts),
      pendingTournamentApprovals: n(a?.pending_approvals),
      stalePendingPayments: n(a?.stale_payments),
      overdueTurns: n(a?.overdue_turns),
      pendingComplaints: n(a?.pending_complaints),
    };
  }

  async daily(period: Period, timezone: string): Promise<DailyPoint[]> {
    const params = [iso(period.from), iso(period.to), timezone];
    const day = (column: string) => `to_char((${column} AT TIME ZONE $3)::date, 'YYYY-MM-DD')`;
    const series = await this.db.query<{ day: string }>(
      `SELECT to_char(s::date, 'YYYY-MM-DD') AS day
       FROM generate_series(($1::timestamptz AT TIME ZONE $3)::date,
                            (($2::timestamptz - interval '1 microsecond') AT TIME ZONE $3)::date,
                            interval '1 day') AS s`,
      params,
    );
    const grouped = async (sql: string) =>
      new Map(
        (await this.db.query<{ day: string; a: unknown; b?: unknown }>(sql, params)).rows.map(
          (r) => [r.day, r] as const,
        ),
      );
    const users = await grouped(
      `SELECT ${day('created_at')} AS day, count(*)::int AS a FROM users
       WHERE role = 'user' AND created_at >= $1 AND created_at < $2 GROUP BY 1`,
    );
    const active = await grouped(
      `SELECT ${day('g.created_at')} AS day, count(DISTINCT gp.player_id)::int AS a,
              count(DISTINCT g.id)::int AS b
       FROM games g JOIN game_players gp ON gp.game_id = g.id
       WHERE g.created_at >= $1 AND g.created_at < $2 AND ${STARTED_GAME} GROUP BY 1`,
    );
    const payments = await grouped(
      `SELECT ${day('created_at')} AS day, count(*)::int AS a, COALESCE(sum(amount), 0) AS b
       FROM payments WHERE status = 'SUCCESS' AND created_at >= $1 AND created_at < $2
       GROUP BY 1`,
    );
    const revenue = await grouped(
      `SELECT ${day('created_at')} AS day, COALESCE(sum(amount), 0) AS a FROM platform_ledger
       WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`,
    );
    return series.rows.map(({ day: key }) => ({
      day: key,
      newPlayers: n(users.get(key)?.a),
      activePlayers: n(active.get(key)?.a),
      gamesStarted: n(active.get(key)?.b),
      paymentsSucceeded: n(payments.get(key)?.a),
      paymentsAmount: n(payments.get(key)?.b),
      platformRevenue: n(revenue.get(key)?.a),
    }));
  }

  async tournamentsInPeriod(period: Period): Promise<TournamentReportRow[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT t.id, ${TOURNAMENT_LABEL} AS name, t.status, t.starts_at, t.ends_at, t.entry_fee, t.participants,
         t.gross_pool, t.platform_fee, t.prize_pool,
         (SELECT count(*) FROM tournament_registrations r
           WHERE r.tournament_id = t.id AND r.status = 'REGISTERED')::int AS registered
       FROM tournaments t WHERE t.starts_at >= $1 AND t.starts_at < $2
       ORDER BY t.starts_at DESC LIMIT 1000`,
      [iso(period.from), iso(period.to)],
    );
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      status: row.status as TournamentStatus,
      startsAt: d(row.starts_at),
      endsAt: d(row.ends_at),
      entryFee: n(row.entry_fee),
      participants: nOrNull(row.participants),
      registered: n(row.registered),
      grossPool: nOrNull(row.gross_pool),
      platformFee: nOrNull(row.platform_fee),
      prizePool: nOrNull(row.prize_pool),
    }));
  }
}
