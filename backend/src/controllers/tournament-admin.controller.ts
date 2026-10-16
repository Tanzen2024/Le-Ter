import type { Request, Response } from 'express';

import { tournamentRankingRules, type TournamentInput } from '../domain/tournaments/tournament';
import { getAuth } from '../middleware/require-auth';
import { CSV_EXPORT } from '../services/tournaments/tournament-export';
import type { TournamentService } from '../services/tournaments/tournament.service';
import {
  parseStatusFilter,
  parseTournamentInput,
  parseTournamentSettingsInput,
} from '../validators/tournament.validators';
import {
  toResultView,
  toRulesView,
  toTournamentSummary,
  tournamentIdOf,
} from './tournament.controller';

/**
 * Administration des tournois (D-054), derrière `requireRole('admin')`. L'administrateur est
 * TOUJOURS l'appelant authentifié ; chaque action de gestion est auditée par le service.
 */
export function createTournamentAdminController(tournaments: TournamentService) {
  const admin = (res: Response) => ({ userId: getAuth(res).userId, isAdmin: true });
  return {
    async list(req: Request, res: Response): Promise<void> {
      const list = await tournaments.listForAdmin(parseStatusFilter(req.query.status));
      res.json({
        tournaments: list.map(({ tournament, registeredCount, creatorName }) => ({
          ...toTournamentSummary(tournament),
          registeredCount,
          ...(creatorName && { creatorName }),
          createdAt: tournament.createdAt,
        })),
      });
    },

    async get(_req: Request, res: Response): Promise<void> {
      const id = tournamentIdOf(res);
      const snapshot = await tournaments.getTournament(id, getAuth(res).userId, { isAdmin: true });
      res.json({
        tournament: {
          ...toTournamentSummary(snapshot.tournament),
          registeredCount: snapshot.registeredCount,
          // Non publié : coefficients en vigueur du calcul (D-071) ; absents une fois figés.
          ...(snapshot.tokenCoefficients && { tokenCoefficients: snapshot.tokenCoefficients }),
        },
      });
    },

    /** Création publiée directement (201). */
    async create(req: Request, res: Response): Promise<void> {
      const input = parseTournamentInput(req.body) as TournamentInput;
      const created = await tournaments.createAsAdmin(getAuth(res).userId, input);
      res.status(201).json({ tournament: toTournamentSummary(created) });
    },

    async update(req: Request, res: Response): Promise<void> {
      const patch = parseTournamentInput(req.body, { partial: true });
      res.json({
        tournament: toTournamentSummary(
          await tournaments.update(tournamentIdOf(res), admin(res), patch),
        ),
      });
    },

    async approve(_req: Request, res: Response): Promise<void> {
      const approved = await tournaments.approve(tournamentIdOf(res), getAuth(res).userId);
      res.json({ tournament: toTournamentSummary(approved) });
    },

    async reject(_req: Request, res: Response): Promise<void> {
      const rejected = await tournaments.reject(tournamentIdOf(res), getAuth(res).userId);
      res.json({ tournament: toTournamentSummary(rejected) });
    },

    /** Annulation avant démarrage : toutes les réservations libérées (ADMIN_CANCELLED). */
    async cancel(_req: Request, res: Response): Promise<void> {
      res.json({
        tournament: toTournamentSummary(await tournaments.cancel(tournamentIdOf(res), admin(res))),
      });
    },

    async registrations(_req: Request, res: Response): Promise<void> {
      const rows = await tournaments.registrations(tournamentIdOf(res));
      res.json({
        registrations: rows.map((r) => ({
          username: r.username,
          status: r.registration.status,
          registeredAt: r.registration.registeredAt,
          ...(r.registration.cancelledAt && { cancelledAt: r.registration.cancelledAt }),
          ...(r.reservation && {
            reservation: { amount: r.reservation.amount, status: r.reservation.status },
          }),
        })),
      });
    },

    async results(_req: Request, res: Response): Promise<void> {
      const { tournament, rows } = await tournaments.results(tournamentIdOf(res));
      // Mêmes lignes figées et mêmes règles que le classement de l'application (D-106) ; la
      // colonne « Parties » affiche le total seul (D-109).
      res.json({
        tournament: toTournamentSummary(tournament),
        rules: toRulesView(tournamentRankingRules(tournament)),
        results: rows.map(toResultView),
      });
    },

    /**
     * Rapport financier (D-112) : fonds capturés, commission, cagnotte distribuable, plan de
     * versement (bénéficiaires, montants, références, statuts, échecs) et finalisation.
     */
    async payouts(_req: Request, res: Response): Promise<void> {
      const report = await tournaments.payoutReport(tournamentIdOf(res));
      const t = report.tournament;
      res.json({
        tournamentId: t.id,
        status: t.status,
        financialState: report.financialState,
        pool: {
          participants: t.participants ?? 0,
          grossPool: t.grossPool ?? 0,
          platformFee: t.platformFee ?? 0,
          platformFeePercent: (t.platformFeeBps ?? 0) / 100,
          prizePool: t.prizePool ?? 0,
          unallocatedPrize: t.unallocatedPrize ?? 0,
        },
        prizeRules: t.prizeRules.map((r) => ({ rank: r.rank, percent: r.shareBps / 100 })),
        planValidatedAt: report.planValidatedAt ?? null,
        blocked: report.blockedAt ? { at: report.blockedAt, reasons: report.blockReasons } : null,
        dueTotal: report.dueTotal,
        creditedTotal: report.creditedTotal,
        payouts: report.payouts.map((p) => ({
          rank: p.rank,
          username: p.username,
          amount: p.amount,
          status: p.status,
          reference: p.idempotencyKey,
          walletTransactionId: p.walletTransactionId ?? null,
          attempts: p.attempts,
          lastError: p.lastError ?? null,
          lastAttemptAt: p.lastAttemptAt ?? null,
          creditedAt: p.creditedAt ?? null,
        })),
      });
    },

    /** Classement final en CSV (format isolé : XLSX ajoutable). */
    async exportResults(_req: Request, res: Response): Promise<void> {
      const { tournament, rows } = await tournaments.results(tournamentIdOf(res));
      const format = CSV_EXPORT;
      res.setHeader('Content-Type', format.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tournoi-${tournament.id}.${format.extension}"`,
      );
      res.send(format.render(tournament, rows));
    },

    async getSettings(_req: Request, res: Response): Promise<void> {
      res.json({ settings: await tournaments.getSettings() });
    },

    async updateSettings(req: Request, res: Response): Promise<void> {
      const patch = parseTournamentSettingsInput(req.body);
      res.json({ settings: await tournaments.updateSettings(getAuth(res).userId, patch) });
    },
  };
}
