import type { Request, Response } from 'express';

import { getDatabaseStatus } from '../config/database';
import { getRedisStatus } from '../config/redis';
import { ADMIN_SESSION_POLICY, ADMIN_THRESHOLDS, ADMIN_TIMEZONE } from '../domain/admin/admin';
import { getAdminSession } from '../middleware/require-admin-session';
import { getRequestId } from '../middleware/request-id';
import { getAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { AdminQueryService } from '../services/admin/admin-query.service';
import type { AdminSessionService } from '../services/admin/admin-session.service';
import type { WithdrawalAvailability } from '../services/withdrawals/withdrawal-availability';
import {
  parseAuditQuery,
  parseGameListQuery,
  parseIdempotencyKey,
  parseLedgerQuery,
  parsePage,
  parsePaymentQuery,
  parsePeriod,
  parseReportName,
  parseUserListQuery,
  parseUuid,
  parseWalletTransactionQuery,
} from '../validators/admin.validators';
import { parseLoginInput } from '../validators/auth.validators';

type Query = Record<string, unknown>;

/** Informations techniques NON sensibles affichées dans les paramètres. */
export interface AdminSystemInfo {
  nodeEnv: string;
  /** Mode CinetPay déduit côté serveur ; jamais la clé, le mot de passe ni les URL. */
  cinetpay: 'sandbox' | 'production' | null;
  /** État des nouveaux retraits (D-077) : mode, motif, avertissements ; jamais de secret ni d'URL. */
  withdrawals?: WithdrawalAvailability;
  /** Santé des paiements (D-100) : fournisseur, réconciliateur, paiements en attente. */
  payments?: () => Promise<unknown>;
}

/**
 * Contrôleurs minces de l'administration (D-061) : valider, appeler le service, renvoyer un
 * DTO. L'administrateur est TOUJOURS l'appelant authentifié (JWT + session admin).
 */
export function createAdminController(deps: {
  auth: AuthService;
  sessions: AdminSessionService;
  queries: AdminQueryService;
  system: AdminSystemInfo;
}) {
  const { auth, sessions, queries, system } = deps;
  const actor = (res: Response) => getAuth(res).userId;
  const q = (req: Request) => req.query as Query;

  return {
    async login(req: Request, res: Response): Promise<void> {
      const result = await sessions.login(parseLoginInput(req.body), {
        requestId: getRequestId(res),
      });
      res.json({ ...result, displayRole: 'SUPER_ADMIN' });
    },

    async logout(_req: Request, res: Response): Promise<void> {
      await sessions.logout(getAuth(res));
      res.status(204).end();
    },

    async session(_req: Request, res: Response): Promise<void> {
      const user = await auth.getCurrentUser(actor(res));
      res.json({
        user,
        displayRole: 'SUPER_ADMIN',
        session: sessions.view(getAdminSession(res)),
      });
    },

    async dashboard(req: Request, res: Response): Promise<void> {
      res.json(await queries.dashboard(parsePeriod(q(req), queries.now())));
    },

    async attention(_req: Request, res: Response): Promise<void> {
      res.json(await queries.attention());
    },

    async users(req: Request, res: Response): Promise<void> {
      res.json(await queries.listUsers(parseUserListQuery(q(req))));
    },

    async user(req: Request, res: Response): Promise<void> {
      res.json({ user: await queries.getUser(parseUuid(req.params.userId, 'userId'), actor(res)) });
    },

    async userGames(req: Request, res: Response): Promise<void> {
      res.json(await queries.userGames(parseUuid(req.params.userId, 'userId'), parsePage(q(req))));
    },

    async userTransactions(req: Request, res: Response): Promise<void> {
      res.json(
        await queries.userTransactions(parseUuid(req.params.userId, 'userId'), parsePage(q(req))),
      );
    },

    async games(req: Request, res: Response): Promise<void> {
      res.json(await queries.listGames(parseGameListQuery(q(req))));
    },

    async game(req: Request, res: Response): Promise<void> {
      res.json({ game: await queries.getGame(parseUuid(req.params.gameId, 'gameId')) });
    },

    async financeOverview(req: Request, res: Response): Promise<void> {
      res.json(await queries.financeOverview(parsePeriod(q(req), queries.now())));
    },

    async walletTransactions(req: Request, res: Response): Promise<void> {
      res.json(await queries.listWalletTransactions(parseWalletTransactionQuery(q(req))));
    },

    async payments(req: Request, res: Response): Promise<void> {
      res.json(await queries.listPayments(parsePaymentQuery(q(req))));
    },

    async payment(req: Request, res: Response): Promise<void> {
      res.json({
        payment: await queries.getPayment(parseUuid(req.params.paymentId, 'paymentId'), actor(res)),
      });
    },

    async verifyPayment(req: Request, res: Response): Promise<void> {
      const paymentId = parseUuid(req.params.paymentId, 'paymentId');
      const key = parseIdempotencyKey(req.get('idempotency-key'));
      res.json(await queries.verifyPayment(paymentId, key, actor(res)));
    },

    async anomalies(_req: Request, res: Response): Promise<void> {
      res.json(await queries.anomalies());
    },

    async platformAccount(_req: Request, res: Response): Promise<void> {
      res.json(await queries.platformAccount());
    },

    async ledgerEntries(req: Request, res: Response): Promise<void> {
      res.json(await queries.ledgerEntries(parseLedgerQuery(q(req))));
    },

    async report(req: Request, res: Response): Promise<void> {
      const name = parseReportName(req.params.report);
      res.json(await queries.report(name, parsePeriod(q(req), queries.now())));
    },

    async exportReport(req: Request, res: Response): Promise<void> {
      const name = parseReportName(req.params.report);
      const period = parsePeriod(q(req), queries.now());
      const csv = await queries.exportReport(name, period, actor(res));
      const day = (date: Date) => date.toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="le-ter-${name}-${day(period.from)}-${day(period.to)}.csv"`,
      );
      // BOM UTF-8 : accents lisibles à l'ouverture dans un tableur.
      res.send(String.fromCharCode(0xfeff) + csv);
    },

    async auditLog(req: Request, res: Response): Promise<void> {
      res.json(await queries.auditLog(parseAuditQuery(q(req))));
    },

    async system(_req: Request, res: Response): Promise<void> {
      res.json({
        serverTime: queries.now().toISOString(),
        environment: system.nodeEnv,
        services: {
          database: await getDatabaseStatus(),
          redis: getRedisStatus(),
          cinetpay: { configured: system.cinetpay !== null, mode: system.cinetpay },
          payments: system.payments
            ? await system.payments().catch(() => ({ status: 'UNAVAILABLE' }))
            : { status: 'NOT_CONFIGURED' },
          withdrawals: system.withdrawals ?? {
            mode: 'unavailable',
            reason: 'PROVIDER_NOT_CONFIGURED',
            warnings: [],
          },
        },
        sessionPolicy: {
          absoluteLifetimeSeconds: ADMIN_SESSION_POLICY.absoluteLifetimeSeconds,
          idleTimeoutSeconds: ADMIN_SESSION_POLICY.idleTimeoutSeconds,
        },
        thresholds: ADMIN_THRESHOLDS,
        timezone: ADMIN_TIMEZONE,
        maintenance: {
          available: false,
          label: "Aucun mode maintenance n'existe dans le backend.",
        },
      });
    },
  };
}
