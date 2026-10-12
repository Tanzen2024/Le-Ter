import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  type AuditAction,
  type AuditTargetType,
} from '../domain/admin/admin';
import type { PaymentStatus } from '../domain/payments/payment';
import { WITHDRAWAL_STATUSES, type WithdrawalStatus } from '../domain/wallet/withdrawal';
import { USER_ROLES, type UserRole } from '../domain/users/user';
import type { AuditListQuery } from '../repositories/admin-audit.repository';
import {
  GAME_ANOMALIES,
  GAME_STATUSES,
  LEDGER_KINDS,
  PAYMENT_STATUSES,
  USER_SORTS,
  WALLET_KINDS,
  WALLET_STATUSES,
  type GameAnomaly,
  type GameListQuery,
  type AdminGameStatus,
  type LedgerKind,
  type LedgerQuery,
  type Page,
  type PaymentQuery,
  type Period,
  type UserListQuery,
  type UserSort,
  type UserStatusFilter,
  type WalletKind,
  type WalletStatus,
  type WalletTransactionQuery,
} from '../repositories/admin-query.repository';
import type { AdminWithdrawalQuery } from '../repositories/withdrawal.repository';
import { REPORTS, type ReportName } from '../services/admin/admin-query.service';
import { ValidationError } from './validation-error';

/**
 * Entrées de l'administration (D-061). Comme pour la détection (D-049) : listes fermées,
 * UUID, dates ISO 8601, bornes de pagination ; un paramètre inconnu ou répété est refusé.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ADMIN_PAGE = { defaultLimit: 25, maxLimit: 100, maxPage: 10_000 } as const;
/** Période d'analyse maximale (tableau de bord, rapports). */
export const MAX_PERIOD_DAYS = 366;
const DAY_MS = 86_400_000;

type Query = Record<string, unknown>;
type Fields = Record<string, string>;

class Reader {
  readonly fields: Fields = {};

  constructor(
    private readonly query: Query,
    allowed: readonly string[],
  ) {
    for (const key of Object.keys(query)) {
      if (!allowed.includes(key)) this.fields[key] = 'Paramètre inconnu.';
    }
  }

  string(key: string, max = 200): string | undefined {
    const value = this.query[key];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || value.length > max) {
      this.fields[key] = 'Valeur invalide.';
      return undefined;
    }
    return value.trim() || undefined;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T | undefined {
    const value = this.string(key);
    if (value === undefined) return undefined;
    if (!(values as readonly string[]).includes(value)) {
      this.fields[key] = 'Valeur non autorisée.';
      return undefined;
    }
    return value as T;
  }

  uuid(key: string): string | undefined {
    const value = this.string(key);
    if (value === undefined) return undefined;
    if (!UUID.test(value.toLowerCase())) {
      this.fields[key] = 'Identifiant invalide.';
      return undefined;
    }
    return value.toLowerCase();
  }

  integer(key: string, min: number, max: number): number | undefined {
    const raw = this.string(key);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || value < min || value > max) {
      this.fields[key] = `Entier attendu entre ${min} et ${max}.`;
      return undefined;
    }
    return value;
  }

  date(key: string): Date | undefined {
    const raw = this.string(key, 40);
    if (raw === undefined) return undefined;
    const value = new Date(raw);
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(value.getTime())) {
      this.fields[key] = 'Date ISO 8601 attendue.';
      return undefined;
    }
    return value;
  }

  page(): Page {
    return {
      page: this.integer('page', 1, ADMIN_PAGE.maxPage) ?? 1,
      limit: this.integer('limit', 1, ADMIN_PAGE.maxLimit) ?? ADMIN_PAGE.defaultLimit,
    };
  }

  range(): { from?: Date; to?: Date } {
    const from = this.date('from');
    const to = this.date('to');
    if (from && to && from >= to) this.fields.to = 'La date de fin doit suivre la date de début.';
    return { ...(from && { from }), ...(to && { to }) };
  }

  done(): void {
    if (Object.keys(this.fields).length > 0) throw new ValidationError(this.fields);
  }
}

const PAGE_KEYS = ['page', 'limit'];

export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value.toLowerCase())) {
    throw new ValidationError({ [field]: 'Identifiant invalide.' });
  }
  return value.toLowerCase();
}

export function parsePage(query: Query): Page {
  const r = new Reader(query, PAGE_KEYS);
  const page = r.page();
  r.done();
  return page;
}

/** Période obligatoire bornée ; par défaut : les 30 derniers jours jusqu'à `now`. */
export function parsePeriod(query: Query, now: Date, extra: readonly string[] = []): Period {
  const r = new Reader(query, ['from', 'to', ...extra]);
  const { from, to } = r.range();
  r.done();
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - 30 * DAY_MS);
  if (start >= end) throw new ValidationError({ from: 'La date de début doit précéder la fin.' });
  if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    throw new ValidationError({ from: `Période limitée à ${MAX_PERIOD_DAYS} jours.` });
  }
  return { from: start, to: end };
}

export function parseUserListQuery(query: Query): UserListQuery {
  const r = new Reader(query, [...PAGE_KEYS, 'q', 'status', 'role', 'sort']);
  const result: UserListQuery = {
    ...r.page(),
    sort: r.oneOf<UserSort>('sort', USER_SORTS) ?? 'created_desc',
  };
  const q = r.string('q', 100);
  const status = r.oneOf<UserStatusFilter>('status', ['active', 'disabled', 'suspended']);
  const role = r.oneOf<UserRole>('role', USER_ROLES);
  r.done();
  return { ...result, ...(q && { q }), ...(status && { status }), ...(role && { role }) };
}

export function parseGameListQuery(query: Query): GameListQuery {
  const r = new Reader(query, [
    ...PAGE_KEYS,
    'status',
    'from',
    'to',
    'playerId',
    'sessionId',
    'tournamentId',
    'gameId',
    'anomaly',
  ]);
  const result: GameListQuery = { ...r.page(), ...r.range() };
  const status = r.oneOf<AdminGameStatus>('status', GAME_STATUSES);
  const anomaly = r.oneOf<GameAnomaly>('anomaly', GAME_ANOMALIES);
  const playerId = r.uuid('playerId');
  const sessionId = r.uuid('sessionId');
  const tournamentId = r.uuid('tournamentId');
  const gameId = r.uuid('gameId');
  r.done();
  return {
    ...result,
    ...(status && { status }),
    ...(anomaly && { anomaly }),
    ...(playerId && { playerId }),
    ...(sessionId && { sessionId }),
    ...(tournamentId && { tournamentId }),
    ...(gameId && { gameId }),
  };
}

export function parseWalletTransactionQuery(query: Query): WalletTransactionQuery {
  const r = new Reader(query, [...PAGE_KEYS, 'kind', 'status', 'userId', 'from', 'to', 'q']);
  const result: WalletTransactionQuery = { ...r.page(), ...r.range() };
  const kind = r.oneOf<WalletKind>('kind', WALLET_KINDS);
  const status = r.oneOf<WalletStatus>('status', WALLET_STATUSES);
  const userId = r.uuid('userId');
  const q = r.string('q', 128);
  r.done();
  return {
    ...result,
    ...(kind && { kind }),
    ...(status && { status }),
    ...(userId && { userId }),
    ...(q && { q }),
  };
}

export function parsePaymentQuery(query: Query): PaymentQuery {
  const r = new Reader(query, [
    ...PAGE_KEYS,
    'status',
    'userId',
    'from',
    'to',
    'minAmount',
    'maxAmount',
    'q',
  ]);
  const result: PaymentQuery = { ...r.page(), ...r.range() };
  const status = r.oneOf<PaymentStatus>('status', PAYMENT_STATUSES);
  const userId = r.uuid('userId');
  const minAmount = r.integer('minAmount', 0, 1_000_000_000);
  const maxAmount = r.integer('maxAmount', 0, 1_000_000_000);
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) {
    r.fields.maxAmount = 'Le maximum doit être supérieur ou égal au minimum.';
  }
  const q = r.string('q', 128);
  r.done();
  return {
    ...result,
    ...(status && { status }),
    ...(userId && { userId }),
    ...(minAmount !== undefined && { minAmount }),
    ...(maxAmount !== undefined && { maxAmount }),
    ...(q && { q }),
  };
}

export function parseWithdrawalQuery(query: Query): AdminWithdrawalQuery {
  const r = new Reader(query, [...PAGE_KEYS, 'status', 'userId', 'from', 'to', 'q']);
  const result: AdminWithdrawalQuery = { ...r.page(), ...r.range() };
  const status = r.oneOf<WithdrawalStatus>('status', WITHDRAWAL_STATUSES);
  const userId = r.uuid('userId');
  const q = r.string('q', 128);
  r.done();
  return {
    ...result,
    ...(status && { status }),
    ...(userId && { userId }),
    ...(q && { q }),
  };
}

export function parseLedgerQuery(query: Query): LedgerQuery {
  const r = new Reader(query, [...PAGE_KEYS, 'kind', 'from', 'to', 'tournamentId']);
  const result: LedgerQuery = { ...r.page(), ...r.range() };
  const kind = r.oneOf<LedgerKind>('kind', LEDGER_KINDS);
  const tournamentId = r.uuid('tournamentId');
  r.done();
  return { ...result, ...(kind && { kind }), ...(tournamentId && { tournamentId }) };
}

export function parseAuditQuery(query: Query): AuditListQuery {
  const r = new Reader(query, [
    ...PAGE_KEYS,
    'action',
    'outcome',
    'actorId',
    'targetType',
    'targetId',
    'from',
    'to',
  ]);
  const result: AuditListQuery = { ...r.page(), ...r.range() };
  const action = r.oneOf<AuditAction>('action', AUDIT_ACTIONS);
  const outcome = r.oneOf<'SUCCESS' | 'FAILURE'>('outcome', ['SUCCESS', 'FAILURE']);
  const actorId = r.uuid('actorId');
  const targetType = r.oneOf<AuditTargetType>('targetType', AUDIT_TARGET_TYPES);
  const targetId = r.uuid('targetId');
  r.done();
  return {
    ...result,
    ...(action && { action }),
    ...(outcome && { outcome }),
    ...(actorId && { actorId }),
    ...(targetType && { targetType }),
    ...(targetId && { targetId }),
  };
}

export function parseReportName(value: unknown): ReportName {
  if (typeof value !== 'string' || !(REPORTS as readonly string[]).includes(value)) {
    throw new ValidationError({ report: 'Rapport inconnu.' });
  }
  return value as ReportName;
}

/** En-tête `Idempotency-Key` : 8 à 128 caractères sûrs. */
export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(value)) {
    throw new ValidationError({
      'Idempotency-Key': 'En-tête Idempotency-Key requis (8 à 128 caractères).',
    });
  }
  return value;
}
