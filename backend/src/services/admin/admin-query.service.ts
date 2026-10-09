import { randomUUID } from 'node:crypto';

import {
  ADMIN_THRESHOLDS,
  ADMIN_TIMEZONE,
  AdminIdempotencyConflictError,
  AdminResourceNotFoundError,
  PaymentProviderUnavailableError,
  type AuditEntry,
} from '../../domain/admin/admin';
import {
  DEPOSIT_AMOUNTS_XAF,
  PaymentNotFoundError,
  PaymentVerificationError,
  TOKENS_PER_XAF,
} from '../../domain/payments/payment';
import type { UserId } from '../../domain/users/user';
import type {
  AdminAuditRepository,
  AuditListQuery,
} from '../../repositories/admin-audit.repository';
import type {
  AdminGameRow,
  AdminPaymentRow,
  AdminQueryRepository,
  AdminUserRow,
  AdminWalletTransaction,
  GameAnomaly,
  GameListQuery,
  LedgerEntry,
  LedgerQuery,
  Page,
  PaymentQuery,
  Period,
  UserListQuery,
  WalletTransactionQuery,
} from '../../repositories/admin-query.repository';
import type { Logger } from '../../utils/logger';
import type { PaymentService } from '../payments/payment.service';
import {
  DATABASE_GUARANTEES,
  orphanDepositAnomalies,
  paymentAnomalies,
  tournamentAnomalies,
  type Anomaly,
} from './admin-reconciliation';

/** Nombre maximal de lignes examinées par contrôle de rapprochement et exportées par rapport. */
export const RECONCILIATION_LIMIT = 500;
export const REPORT_ROW_LIMIT = 10_000;

export const REPORTS = [
  'players',
  'games',
  'tournaments',
  'payments',
  'commissions',
  'reconciliation',
  'admin-activity',
] as const;
export type ReportName = (typeof REPORTS)[number];

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** Téléphone masqué pour les listes : indicatif et deux derniers chiffres. */
export function maskPhone(phone: string): string {
  return phone.length <= 6 ? '••••' : `${phone.slice(0, 4)}••••${phone.slice(-2)}`;
}

function userListView(u: AdminUserRow) {
  return {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: maskPhone(u.phone),
    role: u.role,
    status: u.status,
    createdAt: iso(u.createdAt),
    balance: u.balance,
    reserved: u.reserved,
    gamesPlayed: u.gamesPlayed,
    lastGameAt: iso(u.lastGameAt),
  };
}

/** Indicateurs d'anomalie d'une partie (seuils d'affichage, pas des règles métier). */
export function gameAnomaliesOf(g: AdminGameRow, now: Date): GameAnomaly[] {
  const out: GameAnomaly[] = [];
  const t = now.getTime();
  if (
    g.status === 'waiting' &&
    t - g.createdAt.getTime() > ADMIN_THRESHOLDS.staleWaitingGameHours * 3_600_000
  ) {
    out.push('STALE_WAITING');
  }
  if (
    g.status === 'in_progress' &&
    g.startedAt &&
    t - g.startedAt.getTime() > ADMIN_THRESHOLDS.longRunningGameMinutes * 60_000
  ) {
    out.push('LONG_RUNNING');
  }
  if (
    g.status === 'in_progress' &&
    g.turnDeadlineAt &&
    t - g.turnDeadlineAt.getTime() > ADMIN_THRESHOLDS.overdueTurnSeconds * 1000
  ) {
    out.push('OVERDUE_TURN');
  }
  return out;
}

/**
 * Vue administrative d'une partie : construite champ par champ, SANS état de jeu. Aucune
 * main, carte, paquet ni pli n'existe dans ce DTO, quelle que soit la phase de la partie.
 */
function gameView(g: AdminGameRow, now: Date) {
  const end = g.finishedAt ?? (g.status === 'in_progress' ? now : null);
  return {
    id: g.id,
    status: g.status,
    sessionId: g.sessionId,
    tournament: g.tournamentId ? { id: g.tournamentId, name: g.tournamentName } : null,
    maxPlayers: g.maxPlayers,
    stakeAmount: g.stakeAmount,
    createdAt: iso(g.createdAt),
    startedAt: iso(g.startedAt),
    finishedAt: iso(g.finishedAt),
    durationSeconds:
      g.startedAt && end
        ? Math.max(0, Math.round((end.getTime() - g.startedAt.getTime()) / 1000))
        : null,
    endReason: g.endReason,
    winner: g.winnerId ? { id: g.winnerId, username: g.winnerUsername } : null,
    replayOfGameId: g.replayOfGameId,
    players: g.players.map((p) => ({
      playerId: p.playerId,
      username: p.username,
      seat: p.seat,
      joinedAt: p.joinedAt,
      fledAt: p.fledAt,
    })),
    anomalies: gameAnomaliesOf(g, now),
  };
}

function paymentView(p: AdminPaymentRow) {
  return {
    id: p.id,
    userId: p.userId,
    username: p.username,
    merchantTransactionId: p.merchantTransactionId,
    providerReference: p.providerReference,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    providerStatus: p.providerStatus,
    paymentMethod: p.paymentMethod,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    completedAt: iso(p.completedAt),
    walletTransaction: {
      id: p.walletTransactionId,
      status: p.walletTransactionStatus,
      tokens: p.tokens,
    },
  };
}

function transactionView(t: AdminWalletTransaction) {
  return {
    id: t.id,
    userId: t.userId,
    username: t.username,
    kind: t.kind,
    status: t.status,
    tokens: t.tokens,
    failureCode: t.failureCode,
    providerReference: t.providerReference,
    createdAt: iso(t.createdAt),
    completedAt: iso(t.completedAt),
    paymentId: t.paymentId,
    tournamentId: t.tournamentId,
  };
}

function ledgerView(e: LedgerEntry) {
  return {
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    currency: e.currency,
    feeBps: e.feeBps,
    createdAt: iso(e.createdAt),
    origin: { type: 'TOURNAMENT' as const, id: e.tournamentId, name: e.tournamentName },
    participants: e.participants,
    grossPool: e.grossPool,
  };
}

/**
 * Consultation administrative (D-061) : lecture seule, DTO en liste blanche. Seules les
 * consultations de DÉTAIL d'un joueur ou d'un paiement sont auditées (pas les listes).
 */
export class AdminQueryService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      queries: AdminQueryRepository;
      audit: AdminAuditRepository;
      payments?: PaymentService;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  now(): Date {
    return this.clock();
  }

  // --- Tableau de bord ------------------------------------------------------------------------

  async dashboard(period: Period) {
    const now = this.clock();
    const [facts, daily, recent, reconciliation] = await Promise.all([
      this.deps.queries.dashboard(period, now),
      this.deps.queries.daily(period, ADMIN_TIMEZONE),
      this.deps.audit.list({ page: 1, limit: 8 }),
      this.anomalies(),
    ]);
    return {
      period: { from: iso(period.from), to: iso(period.to), timezone: ADMIN_TIMEZONE },
      generatedAt: iso(now),
      definitions: {
        activePlayer:
          'Joueur présent dans au moins une partie créée sur la période et démarrée (en cours ou terminée). Compté une fois.',
        platformRevenue:
          'Somme des écritures du compte financier de la plateforme (platform_ledger).',
      },
      ...facts,
      reconciliationAnomalies: reconciliation.summary,
      series: daily,
      recentAdminActivity: recent.items.map((e) => this.auditView(e)),
    };
  }

  // --- Joueurs --------------------------------------------------------------------------------

  async listUsers(query: UserListQuery) {
    const { total, items } = await this.deps.queries.listUsers(query);
    return { page: query.page, limit: query.limit, total, items: items.map(userListView) };
  }

  async getUser(id: string, actorId: UserId) {
    const user = await this.deps.queries.findUser(id);
    if (!user) throw new AdminResourceNotFoundError('USER');
    await this.auditView_('USER_VIEWED', 'USER', id, actorId);
    return {
      ...userListView(user),
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      updatedAt: iso(user.updatedAt),
      gamesWon: user.gamesWon,
      activeGameId: user.activeGameId,
      activeSessionId: user.activeSessionId,
      tournamentRegistrations: user.tournamentRegistrations,
      payments: user.payments,
      actions: {
        suspend: {
          available: false,
          reason:
            'Suspension désactivée en V1 : règles non définies pour une partie en cours, une table, un tournoi ou un achat en attente.',
        },
      },
    };
  }

  async userGames(userId: string, page: Page) {
    return this.listGames({ ...page, playerId: userId });
  }

  async userTransactions(userId: string, page: Page) {
    return this.listWalletTransactions({ ...page, userId });
  }

  // --- Parties --------------------------------------------------------------------------------

  async listGames(query: GameListQuery) {
    const now = this.clock();
    const { total, items } = await this.deps.queries.listGames(query, now);
    return {
      page: query.page,
      limit: query.limit,
      total,
      items: items.map((g) => gameView(g, now)),
    };
  }

  async getGame(id: string) {
    const game = await this.deps.queries.findGame(id);
    if (!game) throw new AdminResourceNotFoundError('GAME');
    return {
      ...gameView(game, this.clock()),
      session: game.session,
      creatorUsername: game.creatorUsername,
      firstPlayerUsername: game.firstPlayerUsername,
      chatMessages: game.chatMessages,
      detectionAlerts: game.detectionAlerts,
      privacy: "Les mains, le paquet et les cartes ne sont jamais exposés par l'administration.",
    };
  }

  // --- Finances -------------------------------------------------------------------------------

  async financeOverview(period: Period) {
    const overview = await this.deps.queries.financeOverview(period);
    const ledger = await this.deps.queries.ledgerSummary();
    return {
      period: { from: iso(period.from), to: iso(period.to) },
      currency: 'XAF',
      purchases: {
        label:
          'Achats de jetons des joueurs (CinetPay) — encaissés pour le compte des joueurs, pas un revenu',
        byStatus: overview.purchases,
      },
      walletMovements: overview.walletMovements,
      playerBalances: {
        label: 'Soldes des comptes de jeu (jetons dus aux joueurs)',
        ...overview.liabilities,
      },
      platformRevenue: {
        label: 'Recettes de la plateforme (écritures du compte financier de la plateforme)',
        byKind: overview.platformRevenue,
        total: overview.platformRevenue.reduce((sum, k) => sum + k.amount, 0),
      },
      platformAccountBalance: ledger.total,
      unsupported: UNSUPPORTED_OPERATIONS,
    };
  }

  async listWalletTransactions(query: WalletTransactionQuery) {
    const { total, items } = await this.deps.queries.listWalletTransactions(query);
    return { page: query.page, limit: query.limit, total, items: items.map(transactionView) };
  }

  async listPayments(query: PaymentQuery) {
    const { total, items } = await this.deps.queries.listPayments(query);
    return { page: query.page, limit: query.limit, total, items: items.map(paymentView) };
  }

  async getPayment(id: string, actorId: UserId) {
    const payment = await this.deps.queries.findPayment(id);
    if (!payment) throw new AdminResourceNotFoundError('PAYMENT');
    await this.auditView_('PAYMENT_VIEWED', 'PAYMENT', id, actorId);
    const verifications = await this.deps.audit.list({
      page: 1,
      limit: 20,
      action: 'PAYMENT_VERIFICATION_REQUESTED',
      targetId: id,
    });
    return {
      ...paymentView(payment),
      initializationFailure: payment.initializationFailure,
      settlementAnomaly: payment.settlementAnomaly,
      verification: {
        available:
          payment.status === 'PENDING' &&
          payment.providerReference !== null &&
          this.deps.payments?.providerConfigured === true,
        providerConfigured: this.deps.payments?.providerConfigured === true,
        history: verifications.items.map((e) => this.auditView(e)),
      },
    };
  }

  /**
   * Revérification d'un paiement auprès de CinetPay (serveur à serveur), auditée. La même
   * `Idempotency-Key` rejouée renvoie le résultat déjà obtenu sans nouvel appel.
   */
  async verifyPayment(paymentId: string, idempotencyKey: string, actorId: UserId) {
    const previous = await this.deps.audit.findVerification(idempotencyKey);
    if (previous) {
      if (previous.targetId !== paymentId) throw new AdminIdempotencyConflictError();
      return { replayed: true, ...(previous.details.result as Record<string, unknown>) };
    }
    const payments = this.deps.payments;
    if (!payments?.providerConfigured) throw new PaymentProviderUnavailableError();
    let result: Record<string, unknown>;
    let outcome: AuditEntry['outcome'] = 'SUCCESS';
    try {
      const verified = await payments.verifyForAdmin(paymentId);
      result = { outcome: verified.outcome, status: verified.status };
    } catch (err) {
      if (err instanceof PaymentNotFoundError) throw new AdminResourceNotFoundError('PAYMENT');
      outcome = 'FAILURE';
      result = {
        outcome: 'error',
        reason: err instanceof PaymentVerificationError ? err.reason : 'provider_error',
      };
    }
    await this.deps.audit.insert({
      id: randomUUID(),
      actorId,
      action: 'PAYMENT_VERIFICATION_REQUESTED',
      targetType: 'PAYMENT',
      targetId: paymentId,
      outcome,
      details: { idempotencyKey, result },
      createdAt: this.clock(),
    });
    this.deps.logger.info('admin payment verification', { paymentId, actorId, ...result });
    return { replayed: false, ...result };
  }

  // --- Rapprochement --------------------------------------------------------------------------

  async anomalies() {
    const now = this.clock();
    const [payments, orphans, tournaments] = await Promise.all([
      this.deps.queries.paymentReconciliation({
        now,
        staleMinutes: ADMIN_THRESHOLDS.stalePendingPaymentMinutes,
        allowedAmounts: DEPOSIT_AMOUNTS_XAF,
        tokensPerUnit: TOKENS_PER_XAF,
        limit: RECONCILIATION_LIMIT,
      }),
      this.deps.queries.orphanDeposits(RECONCILIATION_LIMIT),
      this.deps.queries.tournamentLedgerFacts(),
    ]);
    const items: Anomaly[] = [
      ...paymentAnomalies(payments, now),
      ...orphanDepositAnomalies(orphans),
      ...tournamentAnomalies(tournaments),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const byType: Record<string, number> = {};
    for (const a of items) byType[a.type] = (byType[a.type] ?? 0) + 1;
    return {
      generatedAt: iso(now),
      summary: {
        total: items.length,
        critical: items.filter((a) => a.severity === 'CRITICAL').length,
        warning: items.filter((a) => a.severity === 'WARNING').length,
        byType,
      },
      checked: {
        tournaments: tournaments.length,
        paymentCandidates: payments.length,
        limitPerControl: RECONCILIATION_LIMIT,
      },
      thresholds: { stalePendingPaymentMinutes: ADMIN_THRESHOLDS.stalePendingPaymentMinutes },
      guaranteedByDatabase: DATABASE_GUARANTEES,
      items,
    };
  }

  // --- Compte financier de la plateforme ------------------------------------------------------

  async platformAccount() {
    const [summary, reconciliation] = await Promise.all([
      this.deps.queries.ledgerSummary(),
      this.anomalies(),
    ]);
    const tournamentAnomalyCount = reconciliation.items.filter(
      (a) => a.domain === 'TOURNAMENT',
    ).length;
    return {
      name: 'Compte financier de la plateforme Le-Ter',
      technicalId: 'platform_ledger',
      nature:
        "Journal des recettes de la plateforme (entrées seulement). Ce n'est ni un compte utilisateur, ni un portefeuille, ni un compte bancaire.",
      currency: summary.currency,
      computedBalance: {
        amount: summary.total,
        label:
          'Solde comptable calculé (somme des écritures ; aucune sortie n’est prise en charge)',
      },
      byKind: summary.byKind.map((k) => ({ ...k, description: LEDGER_KIND_DESCRIPTIONS[k.kind] })),
      entries: summary.entries,
      firstEntryAt: iso(summary.firstEntryAt),
      lastEntryAt: iso(summary.lastEntryAt),
      treasury: {
        integrated: false,
        label: 'Trésorerie réelle (CinetPay, banque) : non intégrée',
      },
      outgoing: {
        supported: false,
        label: 'Aucune sortie (versement, retrait) n’est prise en charge',
      },
      ordinaryGamesCommission: {
        defined: false,
        label: 'Aucune commission sur les parties ordinaires : règle non définie (R-37)',
      },
      reconciliation: {
        tournamentAnomalies: tournamentAnomalyCount,
        status: tournamentAnomalyCount === 0 ? 'BALANCED' : 'ANOMALIES',
      },
    };
  }

  async ledgerEntries(query: LedgerQuery) {
    const { total, items } = await this.deps.queries.listLedger(query);
    return { page: query.page, limit: query.limit, total, items: items.map(ledgerView) };
  }

  // --- Rapports -------------------------------------------------------------------------------

  async report(name: ReportName, period: Period) {
    const now = this.clock();
    const base = {
      report: name,
      period: { from: iso(period.from), to: iso(period.to), timezone: ADMIN_TIMEZONE },
      generatedAt: iso(now),
    };
    switch (name) {
      case 'players':
      case 'games':
      case 'payments': {
        const daily = await this.deps.queries.daily(period, ADMIN_TIMEZONE);
        const columns = REPORT_COLUMNS[name];
        return {
          ...base,
          criteria: REPORT_CRITERIA[name],
          columns,
          rows: daily.map((d) => pick(d as unknown as Record<string, unknown>, columns)),
        };
      }
      case 'tournaments': {
        const rows = await this.deps.queries.tournamentsInPeriod(period);
        return {
          ...base,
          criteria: REPORT_CRITERIA.tournaments,
          columns: REPORT_COLUMNS.tournaments,
          rows: rows.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            startsAt: iso(t.startsAt),
            endsAt: iso(t.endsAt),
            entryFee: t.entryFee,
            registered: t.registered,
            participants: t.participants,
            grossPool: t.grossPool,
            platformFee: t.platformFee,
            prizePool: t.prizePool,
          })),
        };
      }
      case 'commissions': {
        const { items } = await this.deps.queries.listLedger({
          page: 1,
          limit: REPORT_ROW_LIMIT,
          from: period.from,
          to: period.to,
        });
        return {
          ...base,
          criteria: REPORT_CRITERIA.commissions,
          columns: REPORT_COLUMNS.commissions,
          rows: items.map((e) => ({
            createdAt: iso(e.createdAt),
            kind: e.kind,
            amount: e.amount,
            feeBps: e.feeBps,
            tournamentId: e.tournamentId,
            tournamentName: e.tournamentName,
            participants: e.participants,
            grossPool: e.grossPool,
          })),
        };
      }
      case 'reconciliation': {
        const anomalies = await this.anomalies();
        return {
          ...base,
          criteria: REPORT_CRITERIA.reconciliation,
          columns: REPORT_COLUMNS.reconciliation,
          rows: anomalies.items.map((a) => ({
            date: a.date,
            type: a.type,
            severity: a.severity,
            reference: a.reference.label,
            referenceId: a.reference.id,
            amount: a.amount,
            explanation: a.explanation,
          })),
        };
      }
      case 'admin-activity': {
        const { items } = await this.deps.audit.list({
          page: 1,
          limit: REPORT_ROW_LIMIT,
          from: period.from,
          to: period.to,
        });
        return {
          ...base,
          criteria: REPORT_CRITERIA['admin-activity'],
          columns: REPORT_COLUMNS['admin-activity'],
          rows: items.map((e) => ({
            createdAt: iso(e.createdAt),
            action: e.action,
            outcome: e.outcome,
            actor: e.actorUsername,
            targetType: e.targetType,
            targetId: e.targetId,
          })),
        };
      }
    }
  }

  /** Export CSV d'un rapport (colonnes en liste blanche), audité REPORT_EXPORTED. */
  async exportReport(name: ReportName, period: Period, actorId: UserId): Promise<string> {
    const report = await this.report(name, period);
    await this.deps.audit.insert({
      id: randomUUID(),
      actorId,
      action: 'REPORT_EXPORTED',
      targetType: 'REPORT',
      targetId: null,
      outcome: 'SUCCESS',
      details: {
        report: name,
        from: report.period.from,
        to: report.period.to,
        rows: report.rows.length,
      },
      createdAt: this.clock(),
    });
    return toCsv(report.columns, report.rows as Record<string, unknown>[]);
  }

  // --- Journal d'audit ------------------------------------------------------------------------

  async auditLog(query: AuditListQuery) {
    const { total, items } = await this.deps.audit.list(query);
    return {
      page: query.page,
      limit: query.limit,
      total,
      items: items.map((e) => this.auditView(e)),
    };
  }

  auditView(e: AuditEntry & { actorUsername?: string | null }) {
    return {
      id: e.id,
      action: e.action,
      outcome: e.outcome,
      actor: e.actorId ? { id: e.actorId, username: e.actorUsername ?? null } : null,
      target: { type: e.targetType, id: e.targetId },
      details: e.details,
      createdAt: iso(e.createdAt),
    };
  }

  private async auditView_(
    action: 'USER_VIEWED' | 'PAYMENT_VIEWED',
    targetType: 'USER' | 'PAYMENT',
    targetId: string,
    actorId: UserId,
  ) {
    await this.deps.audit.insert({
      id: randomUUID(),
      actorId,
      action,
      targetType,
      targetId,
      outcome: 'SUCCESS',
      details: {},
      createdAt: this.clock(),
    });
  }
}

export const UNSUPPORTED_OPERATIONS = [
  {
    operation: 'REFUND',
    label: 'Remboursement',
    reason: 'Non pris en charge par l’intégration CinetPay (achats seulement, D-050).',
  },
  {
    operation: 'WITHDRAWAL',
    label: 'Retrait vers Mobile Money',
    reason: 'Aucun fournisseur de décaissement ; montants et conversion non définis (R-13, R-16).',
  },
  {
    operation: 'MANUAL_CREDIT',
    label: 'Crédit ou débit manuel d’un solde',
    reason: 'Aucune règle métier ne l’autorise.',
  },
  {
    operation: 'PLATFORM_PAYOUT',
    label: 'Sortie du compte financier de la plateforme',
    reason: 'Aucune règle de versement définie.',
  },
  {
    operation: 'GAME_COMMISSION',
    label: 'Commission sur les parties ordinaires',
    reason: 'Règle non définie (R-37).',
  },
] as const;

const LEDGER_KIND_DESCRIPTIONS = {
  TOURNAMENT_PLATFORM_FEE:
    'Commission d’un tournoi : floor(cagnotte brute × taux / 10 000), au démarrage.',
  UNALLOCATED_PRIZE: 'Part des gains des rangs payés non occupés, au calcul des résultats.',
} as const;

const REPORT_COLUMNS: Record<ReportName, readonly string[]> = {
  players: ['day', 'newPlayers', 'activePlayers'],
  games: ['day', 'gamesStarted', 'activePlayers'],
  payments: ['day', 'paymentsSucceeded', 'paymentsAmount', 'platformRevenue'],
  tournaments: [
    'id',
    'name',
    'status',
    'startsAt',
    'endsAt',
    'entryFee',
    'registered',
    'participants',
    'grossPool',
    'platformFee',
    'prizePool',
  ],
  commissions: [
    'createdAt',
    'kind',
    'amount',
    'feeBps',
    'tournamentId',
    'tournamentName',
    'participants',
    'grossPool',
  ],
  reconciliation: ['date', 'type', 'severity', 'reference', 'referenceId', 'amount', 'explanation'],
  'admin-activity': ['createdAt', 'action', 'outcome', 'actor', 'targetType', 'targetId'],
};

const REPORT_CRITERIA: Record<ReportName, string> = {
  players:
    'Par jour (Africa/Douala) : nouveaux comptes joueurs ; joueurs actifs = présents dans une partie créée ce jour-là et démarrée.',
  games: 'Par jour (Africa/Douala) : parties créées ce jour-là et démarrées ; joueurs distincts.',
  payments:
    'Par jour (Africa/Douala) : paiements CinetPay réussis (nombre, montant XAF) ; recettes de la plateforme enregistrées.',
  tournaments: 'Tournois dont le début est dans la période (1 000 au plus).',
  commissions: 'Écritures du compte financier de la plateforme créées dans la période.',
  reconciliation: 'Anomalies ouvertes au moment du rapport (indépendant de la période).',
  'admin-activity': 'Événements du journal d’audit de la période.',
};

function pick(row: Record<string, unknown>, columns: readonly string[]) {
  return Object.fromEntries(columns.map((c) => [c, row[c]]));
}

/** CSV RFC 4180 ; neutralise les formules des tableurs (`=`, `+`, `-`, `@` en tête). */
export function toCsv(columns: readonly string[], rows: Record<string, unknown>[]): string {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return '';
    let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join(
    '\r\n',
  );
}
