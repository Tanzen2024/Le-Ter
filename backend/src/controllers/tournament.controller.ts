import type { Request, Response } from 'express';

import {
  canPlayTournamentGame,
  type Tournament,
  type TournamentId,
  type TournamentInput,
  type TournamentResultRow,
} from '../domain/tournaments/tournament';
import { getAuth } from '../middleware/require-auth';
import { getRequestId } from '../middleware/request-id';
import { shareSummary } from '../services/tournaments/tournament-export';
import type {
  TournamentService,
  TournamentSnapshot,
} from '../services/tournaments/tournament.service';
import { parseTournamentInput } from '../validators/tournament.validators';

/**
 * Contrôleurs minces des tournois côté joueur (D-054) : identité issue du JWT, forme de la
 * requête, appel de TournamentService, vue publique. Aucune décision ici.
 */
export function createTournamentController(tournaments: TournamentService) {
  return {
    /**
     * Liste des tournois (D-065) : publiés à venir ou en cours (début le plus proche
     * d'abord), puis l'historique récent ; chaque tournoi avec MON inscription.
     */
    async list(_req: Request, res: Response): Promise<void> {
      const { current, history, now } = await tournaments.listForPlayer(getAuth(res).userId);
      res.json({
        tournaments: current.map(toTournamentView),
        history: history.map(toTournamentView),
        serverNow: now,
      });
    },

    /** Tournoi à afficher (en cours, sinon à venir, sinon terminé récemment), ou null. */
    async active(_req: Request, res: Response): Promise<void> {
      const snapshot = await tournaments.getFeatured(getAuth(res).userId);
      res.json({
        tournament: snapshot ? toTournamentView(snapshot) : null,
        serverNow: snapshot?.now ?? new Date(),
      });
    },

    /**
     * Prochain tournoi à venir auquel je suis inscrit (D-059) : seulement ce que l'accueil
     * affiche (date, début, fin), ou null. Sélection faite par le serveur, sur son horloge.
     */
    async next(_req: Request, res: Response): Promise<void> {
      const t = await tournaments.nextRegistered(getAuth(res).userId);
      res.json({
        tournament: t
          ? {
              tournamentId: t.id,
              startsAt: t.startsAt.toISOString(),
              endsAt: t.endsAt.toISOString(),
              timezone: t.timezone,
            }
          : null,
      });
    },

    async get(_req: Request, res: Response): Promise<void> {
      const { userId, role } = getAuth(res);
      const snapshot = await tournaments.getTournament(tournamentIdOf(res), userId, {
        isAdmin: role === 'admin',
      });
      res.json({ tournament: toTournamentView(snapshot) });
    },

    /** Mes tournois proposés (brouillons, en attente, publiés). */
    async mine(_req: Request, res: Response): Promise<void> {
      const list = await tournaments.listMine(getAuth(res).userId);
      res.json({ tournaments: list.map(toTournamentSummary) });
    },

    /** Proposition d'un joueur : brouillon (201), soumis ensuite à l'approbation. */
    async create(req: Request, res: Response): Promise<void> {
      const input = parseTournamentInput(req.body);
      const created = await tournaments.createAsPlayer(
        getAuth(res).userId,
        input as TournamentInput,
      );
      res.status(201).json({ tournament: toTournamentSummary(created) });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { userId } = getAuth(res);
      const patch = parseTournamentInput(req.body, { partial: true });
      const updated = await tournaments.update(
        tournamentIdOf(res),
        { userId, isAdmin: false },
        patch,
      );
      res.json({ tournament: toTournamentSummary(updated) });
    },

    async submit(_req: Request, res: Response): Promise<void> {
      const submitted = await tournaments.submit(tournamentIdOf(res), getAuth(res).userId);
      res.json({ tournament: toTournamentSummary(submitted) });
    },

    /** Le créateur retire sa proposition (brouillon ou en attente). */
    async withdraw(_req: Request, res: Response): Promise<void> {
      const { userId } = getAuth(res);
      const cancelled = await tournaments.cancel(tournamentIdOf(res), { userId, isAdmin: false });
      res.json({ tournament: toTournamentSummary(cancelled) });
    },

    /** Inscription + réservation du prix d'entrée (201). */
    async register(_req: Request, res: Response): Promise<void> {
      const snapshot = await tournaments.register(tournamentIdOf(res), getAuth(res).userId, {
        requestId: getRequestId(res),
      });
      res.status(201).json({ tournament: toTournamentView(snapshot) });
    },

    /** Désinscription avant la fermeture : réservation libérée. */
    async unregister(_req: Request, res: Response): Promise<void> {
      const snapshot = await tournaments.unregister(tournamentIdOf(res), getAuth(res).userId, {
        requestId: getRequestId(res),
      });
      res.json({ tournament: toTournamentView(snapshot) });
    },

    /** Table attribuée par le serveur : `{ tournamentId, sessionId, gameId }`. */
    async join(_req: Request, res: Response): Promise<void> {
      res.json(
        await tournaments.join(tournamentIdOf(res), getAuth(res).userId, {
          requestId: getRequestId(res),
        }),
      );
    },

    /** Classement en direct, ou final une fois les résultats validés. */
    async standings(_req: Request, res: Response): Promise<void> {
      const { userId, role } = getAuth(res);
      const { tournament, live, rows } = await tournaments.standings(tournamentIdOf(res), userId, {
        isAdmin: role === 'admin',
      });
      res.json({ tournamentId: tournament.id, live, standings: rows.map(toResultView) });
    },

    async results(_req: Request, res: Response): Promise<void> {
      const { tournament, rows } = await tournaments.results(tournamentIdOf(res));
      res.json({
        tournament: toTournamentSummary(tournament),
        results: rows.map(toResultView),
        share: shareSummary(tournament, rows),
      });
    },
  };
}

/** Champs publics d'un tournoi (aucune donnée personnelle, aucun identifiant interne). */
export function toTournamentSummary(t: Tournament) {
  return {
    tournamentId: t.id,
    status: t.status,
    creatorType: t.creatorType,
    timezone: t.timezone,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    registrationClosesAt: t.registrationClosesAt ?? t.startsAt,
    entryFee: t.entryFee,
    currency: t.currency,
    minimumPlayers: t.minimumPlayers,
    ...(t.maximumPlayers !== undefined && { maximumPlayers: t.maximumPlayers }),
    ...(t.platformFeeBps !== undefined && { platformFeePercent: t.platformFeeBps / 100 }),
    ...(t.rankingWeights && {
      rankingWeights: {
        tokensPercent: t.rankingWeights.tokensBps / 100,
        gamesPercent: t.rankingWeights.gamesBps / 100,
      },
    }),
    initialTournamentTokens: t.initialTournamentTokens,
    stakePerGame: t.stakePerGame,
    prizeRules: t.prizeRules.map((r) => ({ rank: r.rank, percent: r.shareBps / 100 })),
    ...(t.cancellationReason && { cancellationReason: t.cancellationReason }),
    ...(t.grossPool !== undefined && {
      pool: {
        participants: t.participants ?? 0,
        grossPool: t.grossPool,
        platformFee: t.platformFee ?? 0,
        prizePool: t.prizePool ?? 0,
        ...(t.unallocatedPrize !== undefined && { unallocatedPrize: t.unallocatedPrize }),
      },
    }),
  };
}

/**
 * Vue d'un tournoi pour un joueur : la sienne inscription et sa réservation, son compte de
 * tournoi, le podium. `canRegister` / `canJoin` sont des INDICATIONS : chaque action est
 * revérifiée par le serveur. `serverNow` : le client aligne son compte à rebours.
 */
export function toTournamentView(s: TournamentSnapshot) {
  const t = s.tournament;
  const registered = s.registration?.status === 'REGISTERED';
  const now = s.now.getTime();
  const full = t.maximumPlayers !== undefined && s.registeredCount >= t.maximumPlayers;
  const windowOpen =
    t.status === 'REGISTRATION_OPEN' && now < (t.registrationClosesAt ?? t.startsAt).getTime();
  return {
    ...toTournamentSummary(t),
    registeredCount: s.registeredCount,
    registration: registered
      ? {
          status: 'REGISTERED' as const,
          registeredAt: s.registration!.registeredAt,
          ...(s.reservation && {
            reservation: {
              amount: s.reservation.amount,
              currency: s.reservation.currency,
              status: s.reservation.status,
            },
          }),
        }
      : null,
    account: s.account
      ? {
          currentTokens: s.account.currentTokens,
          initialTokens: s.account.initialTokens,
          gamesPlayed: s.account.gamesPlayed,
          gamesWon: s.account.gamesWon,
          status: s.account.status,
          ...(s.account.rank !== undefined && { rank: s.account.rank }),
          prizeAmount: s.account.prizeAmount,
        }
      : null,
    podium: s.podium.map(toResultView),
    canRegister: windowOpen && !registered && !full,
    canUnregister: windowOpen && registered,
    canJoin:
      t.status === 'IN_PROGRESS' &&
      now < t.endsAt.getTime() &&
      s.account !== null &&
      canPlayTournamentGame(s.account.currentTokens, t.stakePerGame),
    serverNow: s.now,
  };
}

export function toResultView(r: TournamentResultRow) {
  return {
    rank: r.rank,
    username: r.username,
    initialTokens: r.initialTokens,
    remainingTokens: r.remainingTokens,
    gamesPlayed: r.gamesPlayed,
    gamesWon: r.gamesWon,
    ...(r.score !== undefined && { score: r.score }),
    prizePercent: r.prizeShareBps / 100,
    prizeAmount: r.prizeAmount,
    paid: r.paidAt !== undefined,
  };
}

export function tournamentIdOf(res: Response): TournamentId {
  const { tournamentId } = res.locals;
  if (!tournamentId) {
    throw new Error('tournamentId absent : route sans paramètre :tournamentId validé');
  }
  return tournamentId;
}
