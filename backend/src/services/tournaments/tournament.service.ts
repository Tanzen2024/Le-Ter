import { randomUUID } from 'node:crypto';

import type { Game } from '../../domain/game/game';
import {
  GameFullError,
  GameNotJoinableError,
  GameVersionConflictError,
} from '../../domain/game/game-errors';
import type { GameId, PlayerId } from '../../domain/game/game-id';
import {
  PlayerAlreadyInSessionError,
  SessionClosedError,
  SessionFullError,
  type SessionId,
} from '../../domain/sessions/session';
import {
  accountStatusFor,
  AlreadyRegisteredError,
  canPlayTournamentGame,
  assertTransition,
  computePool,
  computePrizes,
  InvalidTournamentError,
  InvalidTournamentTransitionError,
  newTournamentId,
  NotRegisteredError,
  NotTournamentCreatorError,
  percentToBps,
  PRE_CAPTURE_STATUSES,
  rankAccounts,
  rankingReferences,
  rankingWeightsError,
  rankingWeightsOf,
  RESULTS_GRACE_MS,
  START_FAILURE_ALERT_THRESHOLD,
  START_RECOVERY_MS,
  SETTINGS_LIMITS,
  playerLimitsError,
  durationLimitsError,
  coefficientHundredths,
  tokenCoefficientsError,
  settleGameTokens,
  STARTED_STATUSES,
  TooManyPendingTournamentsError,
  TooManyWaitingTournamentsError,
  TOKEN_SETUP_STATUSES,
  TOURNAMENT_LIMITS,
  tournamentLabel,
  TOURNAMENT_TABLE_AUTO_START_MS,
  TOURNAMENT_TABLE_SIZE,
  TournamentBusyError,
  TournamentCancelledError,
  TournamentCompletedError,
  TournamentFullError,
  TournamentGameInProgressError,
  TournamentLockedError,
  TournamentNotFoundError,
  TournamentNotStartedError,
  TournamentOutOfTokensError,
  TournamentRegistrationClosedError,
  TournamentResultsUnavailableError,
  TournamentStartedError,
  TournamentTableAvailableError,
  TournamentTableRefusedError,
  tournamentRankingWeights,
  tournamentTokenSetup,
  validateTournamentInput,
  type CancellationReason,
  type CreatorType,
  type Tournament,
  type TournamentId,
  type TournamentInput,
  type TournamentPlayerAccount,
  type TournamentRegistration,
  type TournamentSettings,
  type TournamentStatus,
  type TournamentTokenSetup,
} from '../../domain/tournaments/tournament';
import { playerIdOf, type UserId } from '../../domain/users/user';
import type {
  AdminTournamentListItem,
  NotificationDraft,
  RegistrationListItem,
  ResultDraft,
  TournamentRepository,
  TournamentResultRow,
  TournamentUnitOfWork,
} from '../../repositories/tournament.repository';
import type { WalletReservation } from '../../repositories/wallet-reservations';
import { BackgroundTasks } from '../../utils/background-tasks';
import { KeyedSerialQueue } from '../../utils/keyed-serial-queue';
import type { Logger } from '../../utils/logger';
import type { GameService } from '../game/game.service';
import type { SessionService } from '../sessions/session.service';

/** Un tournoi terminé ou annulé reste mis en avant ce temps-là (résultats, information). */
export const RECENT_TOURNAMENT_VISIBILITY_MS = 24 * 60 * 60 * 1000;

/**
 * Liste des tournois : un tournoi terminé (COMPLETED) y reste 7 jours après sa fin PRÉVUE, un
 * tournoi annulé 7 jours après son annulation RÉELLE. Affichage seulement : rien n'est supprimé.
 */
export const LIST_HISTORY_VISIBILITY_MS = 7 * 24 * 60 * 60 * 1000;

/** Tables candidates essayées avant d'en ouvrir une nouvelle. */
const JOIN_CANDIDATES = 5;
/** Tours « rejoindre, sinon ouvrir » (une autre instance peut ouvrir une table entre-temps). */
const TABLE_ATTEMPTS = 3;
/** Entrées dans la partie d'une table perdues sur la version (autre instance) avant TOURNAMENT_BUSY. */
const SEAT_ATTEMPTS = 3;
/** Nom de session (D-039) : 40 caractères au plus. */
const SESSION_NAME_MAX_LENGTH = 40;
/**
 * Liste des joueurs (D-065) : au plus 5 tournois en attente (D-059) et un seul en cours à la
 * fois (pas de chevauchement) ; marge comprise. Historique : les plus récents.
 */
const LIST_CURRENT_LIMIT = 20;
const LIST_HISTORY_LIMIT = 10;
/** Garde-fou : nombre maximal de transitions appliquées par `advance` en un appel. */
const MAX_STEPS = 40;

const RESULT_STATUSES: readonly TournamentStatus[] = [
  'RESULTS_VALIDATED',
  'DISTRIBUTING_PRIZES',
  'COMPLETED',
];
const WEIGHT_SETTING_KEYS = ['rankingTokensWeightPercent', 'rankingGamesWeightPercent'] as const;
/** Coefficients des jetons de départ et de la mise (D-071) : 2 décimales au plus. */
const COEFFICIENT_SETTING_KEYS = ['initialTokensCoefficient', 'stakePerGameCoefficient'] as const;
const SETTLEABLE_STATUSES: readonly TournamentStatus[] = ['IN_PROGRESS', 'CALCULATING_RESULTS'];

export interface TournamentServiceDependencies {
  tournaments: TournamentRepository;
  sessions: SessionService;
  games: GameService;
  logger: Logger;
  clock?: () => Date;
  /** Délai après `starts_at` avant d'annuler un démarrage bloqué (défaut START_RECOVERY_MS). */
  startRecoveryMs?: number;
}

interface CallMeta {
  requestId?: string;
}

/** Acteur d'une commande de gestion (identité issue du JWT, rôle relu en base). */
export interface TournamentActor {
  userId: UserId;
  isAdmin: boolean;
}

/** Tournoi vu par un joueur. */
export interface TournamentSnapshot {
  tournament: Tournament;
  registeredCount: number;
  registration: TournamentRegistration | null;
  reservation: WalletReservation | null;
  account: TournamentPlayerAccount | null;
  /** Les trois premiers, dès que les résultats sont validés. */
  podium: TournamentResultRow[];
  now: Date;
  /**
   * Tournoi non publié (D-071) : coefficients en vigueur ayant servi à calculer jetons de
   * départ et mise. Absent une fois publiés : les valeurs sont figées.
   */
  tokenCoefficients?: Pick<
    TournamentSettings,
    'initialTokensCoefficient' | 'stakePerGameCoefficient'
  >;
}

/** Table attribuée par `join` : l'écran de jeu s'ouvre sur `gameId`. */
export interface TournamentSeat {
  tournamentId: TournamentId;
  sessionId: SessionId;
  gameId: GameId;
}

export type TournamentPatch = Partial<TournamentInput>;

/**
 * Tournois financiers (D-054). Seul point de mutation des tournois : toutes les transitions
 * d'état sont ici, chacune dans UNE transaction PostgreSQL sur la ligne verrouillée, et
 * idempotente (rejouée, elle ne refait rien). Les tables sont des sessions ordinaires
 * (SessionService) et les parties passent par GameService : aucun second moteur de jeu.
 * L'identité de l'acteur vient toujours de l'appelant authentifié (JWT).
 */
export class TournamentService {
  private readonly clock: () => Date;
  /** Recherche-ou-création d'une table, une à la fois par tournoi (dans cette instance). */
  private readonly joinQueue = new KeyedSerialQueue<TournamentId>();
  /** Avancement d'un tournoi, un à la fois par tournoi (dans cette instance). */
  private readonly advanceQueue = new KeyedSerialQueue<TournamentId>();
  private readonly background = new BackgroundTasks();
  /** Échecs de démarrage consécutifs par tournoi (journalisation et alerte seulement). */
  private readonly startFailures = new Map<TournamentId, number>();

  constructor(private readonly deps: TournamentServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  // --- Création et gestion -----------------------------------------------------------

  /**
   * Création par l'administrateur : tournoi PUBLIÉ directement. Limite plateforme des
   * tournois en attente de démarrage (D-059) vérifiée sous le verrou de planification.
   */
  async createAsAdmin(adminId: UserId, input: TournamentInput): Promise<Tournament> {
    const now = this.clock();
    const created = await this.deps.tournaments.transaction(async (uow) => {
      await uow.lockSchedule();
      const settings = await uow.readSettings();
      const valid = validateTournamentInput(input, { now, creatorType: 'ADMIN', settings });
      await assertWaitingCapacity(uow);
      // Jetons de départ et mise calculés depuis les coefficients, figés par la publication.
      const tournament = publish(draftOf(valid, 'ADMIN', adminId, now), settings, now, adminId);
      await uow.insertTournament(tournament);
      await uow.audit({
        actorId: adminId,
        action: 'TOURNAMENT_CREATED',
        tournamentId: tournament.id,
        details: { status: tournament.status, startsAt: tournament.startsAt.toISOString() },
        now,
      });
      return tournament;
    });
    this.deps.logger.info('TOURNAMENT_CREATED', { tournamentId: created.id, creatorType: 'ADMIN' });
    return this.advance(created.id);
  }

  /**
   * Proposition par un joueur : BROUILLON (rien n'est publié ni réservé). Limite de tournois
   * en brouillon ou en attente par joueur (paramètre plateforme).
   */
  async createAsPlayer(userId: UserId, input: TournamentInput): Promise<Tournament> {
    const now = this.clock();
    const created = await this.deps.tournaments.transaction(async (uow) => {
      const settings = await uow.readSettings();
      // Jetons de départ et mise suivent les coefficients jusqu'à l'approbation (D-071).
      const valid = validateTournamentInput(input, { now, creatorType: 'PLAYER', settings });
      const pending = await uow.countPendingByCreator(userId);
      if (pending >= settings.maximumPendingTournamentsPerPlayer) {
        throw new TooManyPendingTournamentsError(settings.maximumPendingTournamentsPerPlayer);
      }
      // Information au plus tôt (D-059) ; la garantie est à l'approbation, sous verrou.
      await assertWaitingCapacity(uow);
      const tournament = draftOf(valid, 'PLAYER', userId, now);
      await uow.insertTournament(tournament);
      return tournament;
    });
    this.deps.logger.info('TOURNAMENT_CREATED', {
      tournamentId: created.id,
      creatorType: 'PLAYER',
    });
    return created;
  }

  /** Le joueur soumet son brouillon à l'approbation. */
  submit(id: TournamentId, userId: UserId): Promise<Tournament> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await this.lock(uow, id);
      if (t.creatorId !== userId) throw new NotTournamentCreatorError(id);
      if (t.status === 'PENDING_APPROVAL') return t;
      const now = this.clock();
      assertPlayerLeadTime(t, now);
      // Règles en vigueur revérifiées (un brouillon a pu être créé sous d'autres limites).
      const valid = validateTournamentInput(inputOf(t), {
        now,
        creatorType: t.creatorType,
        settings: await uow.readSettings(),
      });
      // Information au plus tôt (D-059) ; la garantie est à l'approbation, sous verrou.
      await assertWaitingCapacity(uow);
      return this.transition(uow, t, 'PENDING_APPROVAL', tokensOf(valid));
    });
  }

  /**
   * Approbation par l'administrateur : publication (taux de commission figé ici). Verrou de
   * planification AVANT la ligne du tournoi (même ordre que la création : pas d'interblocage).
   */
  async approve(id: TournamentId, adminId: UserId): Promise<Tournament> {
    const now = this.clock();
    const approved = await this.deps.tournaments.transaction(async (uow) => {
      await uow.lockSchedule();
      const t = await this.lock(uow, id);
      assertTransition(id, t.status, 'SCHEDULED');
      assertPlayerLeadTime(t, now);
      const settings = await uow.readSettings();
      // Règles en vigueur revérifiées avant publication (durée, joueurs, répartition…) ;
      // jetons de départ et mise calculés avec les coefficients en vigueur, figés ici (D-071).
      const valid = validateTournamentInput(inputOf(t), {
        now,
        creatorType: t.creatorType,
        settings,
      });
      await assertWaitingCapacity(uow);
      const saved = await uow.saveTournament(
        publish({ ...t, ...tokensOf(valid) }, settings, now, adminId),
      );
      if (t.creatorId) {
        await uow.notify(
          [notice(t.creatorId, 'TOURNAMENT_APPROVED', saved, `approved:${id}`)],
          now,
        );
      }
      await uow.audit({
        actorId: adminId,
        action: 'TOURNAMENT_APPROVED',
        tournamentId: id,
        details: {},
        now,
      });
      return saved;
    });
    return this.advance(approved.id);
  }

  /** Refus par l'administrateur : annulé (APPROVAL_REJECTED), le créateur est informé. */
  reject(id: TournamentId, adminId: UserId): Promise<Tournament> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await this.lock(uow, id);
      if (t.status !== 'PENDING_APPROVAL') {
        throw new InvalidTournamentTransitionError(id, t.status, 'CANCELLED');
      }
      const now = this.clock();
      const cancelled = await this.cancelInTx(uow, t, 'APPROVAL_REJECTED', now);
      await uow.audit({
        actorId: adminId,
        action: 'TOURNAMENT_REJECTED',
        tournamentId: id,
        details: {},
        now,
      });
      return cancelled;
    });
  }

  /**
   * Annulation AVANT la capture (jamais après : les paiements sont définitifs). Toutes les
   * réservations actives sont libérées dans la même transaction. Idempotente.
   * Administrateur : tout tournoi ; joueur : seulement son tournoi non publié.
   */
  cancel(id: TournamentId, actor: TournamentActor): Promise<Tournament> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await this.lock(uow, id);
      if (t.status === 'CANCELLED') return t;
      if (!actor.isAdmin) {
        if (t.creatorId !== actor.userId) throw new NotTournamentCreatorError(id);
        if (t.status !== 'DRAFT' && t.status !== 'PENDING_APPROVAL') {
          throw new TournamentLockedError(id);
        }
      }
      if (!PRE_CAPTURE_STATUSES.includes(t.status)) throw new TournamentStartedError(id);
      const now = this.clock();
      const reason: CancellationReason = actor.isAdmin ? 'ADMIN_CANCELLED' : 'CREATOR_CANCELLED';
      const cancelled = await this.cancelInTx(uow, t, reason, now);
      if (actor.isAdmin) {
        await uow.audit({
          actorId: actor.userId,
          action: 'TOURNAMENT_CANCELLED',
          tournamentId: id,
          details: { from: t.status, reason },
          now,
        });
      }
      this.deps.logger.info('TOURNAMENT_CANCELLED', { tournamentId: id, reason });
      return cancelled;
    });
  }

  /**
   * Modification avant verrouillage. Dès qu'une inscription est active, plus rien ne change
   * (les inscrits ont réservé à ces conditions). Joueur : son brouillon ou sa proposition en
   * attente seulement. Jetons de départ et mise ne sont jamais saisis (D-071) : calculés
   * depuis les coefficients avant la publication ; ensuite figés, sauf si le prix d'entrée
   * change (possible seulement sans inscrit), qui les recalcule avec les coefficients en vigueur.
   */
  update(id: TournamentId, actor: TournamentActor, patch: TournamentPatch): Promise<Tournament> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await this.lock(uow, id);
      const editable: TournamentStatus[] = actor.isAdmin
        ? ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'REGISTRATION_OPEN']
        : ['DRAFT', 'PENDING_APPROVAL'];
      if (!actor.isAdmin && t.creatorId !== actor.userId) throw new NotTournamentCreatorError(id);
      if (!editable.includes(t.status)) throw new TournamentLockedError(id);
      const now = this.clock();
      const registered = await uow.countActiveRegistrations(id);
      const changed = (Object.keys(patch) as (keyof TournamentPatch)[]).filter(
        (k) => patch[k] !== undefined,
      );
      if (registered > 0 && changed.length > 0) throw new TournamentLockedError(id, changed);
      const settings = await uow.readSettings();
      const frozen =
        !TOKEN_SETUP_STATUSES.includes(t.status) &&
        (patch.entryFee === undefined || patch.entryFee === t.entryFee);
      const valid = validateTournamentInput(
        { ...inputOf(t), ...stripUndefined(patch) },
        {
          now,
          creatorType: actor.isAdmin ? 'ADMIN' : 'PLAYER',
          settings,
          ...(frozen && { frozenTokens: tokensOf(t) }),
        },
      );
      const next: Tournament = {
        ...t,
        ...fieldsOf(valid),
        updatedAt: now,
        ...(t.publishedAt && {
          blockedUntil: blockedUntil(valid.endsAt, settings),
          registrationClosesAt: valid.registrationClosesAt ?? valid.startsAt,
        }),
      };
      const saved = await uow.saveTournament(next);
      if (actor.isAdmin) {
        await uow.audit({
          actorId: actor.userId,
          action: 'TOURNAMENT_UPDATED',
          tournamentId: id,
          details: { fields: changed },
          now,
        });
      }
      return saved;
    });
  }

  // --- Inscription ---------------------------------------------------------------------

  /**
   * Inscription + réservation du prix d'entrée, en UNE transaction (D-054) : aucune
   * inscription sans réservation, aucune réservation sans inscription, aucun débit.
   */
  async register(
    id: TournamentId,
    userId: UserId,
    meta: CallMeta = {},
  ): Promise<TournamentSnapshot> {
    await this.advance(id);
    const log = this.log(id, userId, 'TOURNAMENT_REGISTER', meta);
    try {
      await this.deps.tournaments.transaction(async (uow) => {
        const t = await this.lock(uow, id);
        const now = this.clock();
        if (!registrationWindowOpen(t, now)) {
          throw new TournamentRegistrationClosedError(id, t.status);
        }
        const existing = await uow.findRegistration(id, userId);
        if (existing?.status === 'REGISTERED') throw new AlreadyRegisteredError(id);
        const count = await uow.countActiveRegistrations(id);
        if (t.maximumPlayers !== undefined && count >= t.maximumPlayers) {
          throw new TournamentFullError(id);
        }
        const registration = await uow.upsertRegistration({
          id: randomUUID(),
          tournamentId: id,
          userId,
          status: 'REGISTERED',
          registeredAt: now,
        });
        const reservation = await uow.reserve({
          userId,
          tournamentId: id,
          registrationId: registration.id,
          amount: t.entryFee,
          now,
        });
        await uow.notify(
          [
            notice(
              userId,
              'TOURNAMENT_REGISTRATION_CONFIRMED',
              t,
              `registration:${reservation.id}`,
              {
                reservedAmount: reservation.amount,
              },
            ),
          ],
          now,
        );
      });
    } catch (err) {
      log.warn('tournament registration rejected', { errorName: errorName(err) });
      throw err;
    }
    log.info('TOURNAMENT_REGISTERED');
    return this.getTournament(id, userId);
  }

  /** Désinscription avant la fermeture : la réservation est libérée (aucun remboursement). */
  async unregister(
    id: TournamentId,
    userId: UserId,
    meta: CallMeta = {},
  ): Promise<TournamentSnapshot> {
    await this.advance(id);
    await this.deps.tournaments.transaction(async (uow) => {
      const t = await this.lock(uow, id);
      const now = this.clock();
      if (t.status === 'STARTING' || STARTED_STATUSES.includes(t.status)) {
        throw new TournamentStartedError(id);
      }
      if (!registrationWindowOpen(t, now)) {
        throw new TournamentRegistrationClosedError(id, t.status);
      }
      const registration = await uow.findRegistration(id, userId);
      if (registration?.status !== 'REGISTERED') throw new NotRegisteredError(id);
      const active = (await uow.listActiveRegistrations(id)).find(
        (a) => a.registration.id === registration.id,
      );
      if (active?.reservation) await uow.release(active.reservation.id, now);
      await uow.cancelRegistration(registration.id, now);
    });
    this.log(id, userId, 'TOURNAMENT_UNREGISTER', meta).info('TOURNAMENT_UNREGISTERED');
    return this.getTournament(id, userId);
  }

  // --- Cycle de vie (horloge du serveur) ------------------------------------------------

  /**
   * Applique toutes les transitions dues à cet instant (ouverture et fermeture des
   * inscriptions, démarrage, fin, résultats, gains). Idempotent ; appelé par le
   * planificateur et avant chaque commande.
   */
  advance(id: TournamentId): Promise<Tournament> {
    return this.advanceQueue.run(id, async () => {
      for (let i = 0; i < MAX_STEPS; i += 1) {
        if (!(await this.step(id))) break;
      }
      return this.load(id);
    });
  }

  private async step(id: TournamentId): Promise<boolean> {
    const t = await this.deps.tournaments.findById(id);
    if (!t) return false;
    const now = this.clock();
    const at = now.getTime();
    switch (t.status) {
      case 'DRAFT':
      case 'PENDING_APPROVAL':
        // Jamais publié avant son début : il ne peut plus l'être.
        return at >= t.startsAt.getTime()
          ? this.cancelIfStatus(id, t.status, 'APPROVAL_REJECTED')
          : false;
      case 'SCHEDULED':
        return at >= (t.registrationOpensAt ?? t.publishedAt ?? now).getTime()
          ? this.simpleTransition(id, 'SCHEDULED', 'REGISTRATION_OPEN')
          : false;
      case 'REGISTRATION_OPEN':
        return at >= (t.registrationClosesAt ?? t.startsAt).getTime()
          ? this.simpleTransition(id, 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED')
          : false;
      case 'REGISTRATION_CLOSED':
        return at >= t.startsAt.getTime()
          ? this.simpleTransition(id, 'REGISTRATION_CLOSED', 'STARTING')
          : false;
      case 'STARTING':
        return this.startOrRecover(t, now);
      case 'IN_PROGRESS':
        return at >= t.endsAt.getTime()
          ? this.simpleTransition(id, 'IN_PROGRESS', 'CALCULATING_RESULTS')
          : false;
      case 'CALCULATING_RESULTS':
        return this.calculateResults(id);
      case 'RESULTS_VALIDATED':
        return this.simpleTransition(id, 'RESULTS_VALIDATED', 'DISTRIBUTING_PRIZES');
      case 'DISTRIBUTING_PRIZES':
        return this.distributeOne(id);
      default:
        return false;
    }
  }

  /**
   * Démarrage avec récupération (D-056). Un échec (base indisponible, erreur inattendue) est
   * journalisé, puis retenté au tick suivant ; à partir de START_FAILURE_ALERT_THRESHOLD échecs
   * l'erreur porte `alert: true`. Passé `starts_at` + startRecoveryMs, le tournoi est annulé
   * (SYSTEM_ERROR) et ses réservations ACTIVES libérées. La démarche ne dépend que de données
   * persistées : un redémarrage la reprend telle quelle.
   */
  private async startOrRecover(t: Tournament, now: Date): Promise<boolean> {
    try {
      const started = await this.start(t.id);
      this.startFailures.delete(t.id);
      return started;
    } catch (err) {
      const attempts = (this.startFailures.get(t.id) ?? 0) + 1;
      this.startFailures.set(t.id, attempts);
      const deadline = t.startsAt.getTime() + (this.deps.startRecoveryMs ?? START_RECOVERY_MS);
      this.deps.logger.error('TOURNAMENT_START_FAILED', {
        tournamentId: t.id,
        attempt: attempts,
        recoveryAt: new Date(deadline).toISOString(),
        error: err instanceof Error ? err.message : String(err),
        ...(attempts >= START_FAILURE_ALERT_THRESHOLD && { alert: true }),
      });
      if (now.getTime() < deadline) return false;
      const aborted = await this.abortStuckStart(t.id);
      if (aborted) this.startFailures.delete(t.id);
      return aborted;
    }
  }

  /**
   * Annulation d'un démarrage bloqué, sur la ligne verrouillée : seulement si le tournoi est
   * TOUJOURS en STARTING et qu'AUCUNE réservation n'a été capturée (la capture et le passage
   * IN_PROGRESS sont une seule transaction : une capture validée signifie un démarrage réussi).
   * Sinon rien n'est libéré et une alerte critique est journalisée : jamais de déséquilibre.
   */
  private abortStuckStart(id: TournamentId): Promise<boolean> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await uow.lockTournament(id);
      if (!t || t.status !== 'STARTING') return false;
      const captured = await uow.countCapturedReservations(id);
      if (captured > 0) {
        this.deps.logger.error('TOURNAMENT_START_INCONSISTENT', {
          tournamentId: id,
          captured,
          alert: true,
        });
        return false;
      }
      await this.cancelInTx(uow, t, 'SYSTEM_ERROR', this.clock());
      this.deps.logger.error('TOURNAMENT_CANCELLED', {
        tournamentId: id,
        reason: 'SYSTEM_ERROR',
        alert: true,
      });
      return true;
    });
  }

  /**
   * Démarrage : minimum non atteint → annulé (INSUFFICIENT_PLAYERS), réservations libérées ;
   * sinon capture de toutes les réservations, commission, cagnotte figée, comptes de tournoi
   * et IN_PROGRESS — tout dans UNE transaction.
   */
  private start(id: TournamentId): Promise<boolean> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await uow.lockTournament(id);
      if (!t || t.status !== 'STARTING') return false;
      const now = this.clock();
      const active = await uow.listActiveRegistrations(id);
      // Invariant : aucune inscription sans réservation. Une ligne incohérente n'est pas
      // une participation payée : elle est écartée (jamais de joueur gratuit).
      const paid = active.filter(
        (a) => a.reservation?.status === 'ACTIVE' || a.reservation?.status === 'CAPTURED',
      );
      for (const orphan of active.filter((a) => !paid.includes(a))) {
        this.deps.logger.error('tournament registration without reservation', {
          tournamentId: id,
          registrationId: orphan.registration.id,
        });
        await uow.cancelRegistration(orphan.registration.id, now);
      }
      if (paid.length < t.minimumPlayers) {
        await this.cancelInTx(uow, t, 'INSUFFICIENT_PLAYERS', now);
        this.deps.logger.info('TOURNAMENT_CANCELLED', {
          tournamentId: id,
          reason: 'INSUFFICIENT_PLAYERS',
          registered: paid.length,
        });
        return true;
      }
      for (const { reservation } of paid) {
        await uow.capture(reservation!.id, now);
      }
      const feeBps = t.platformFeeBps ?? 0;
      const pool = computePool(t.entryFee, paid.length, feeBps);
      await uow.recordPlatformEntry({
        tournamentId: id,
        kind: 'TOURNAMENT_PLATFORM_FEE',
        amount: pool.platformFee,
        feeBps,
        now,
      });
      await uow.insertAccounts(
        paid.map(({ registration }) => ({
          id: randomUUID(),
          tournamentId: id,
          playerId: registration.userId,
          registrationId: registration.id,
          registeredAt: registration.registeredAt,
          initialTokens: t.initialTournamentTokens,
          currentTokens: t.initialTournamentTokens,
          gamesPlayed: 0,
          gamesWon: 0,
          prizeAmount: 0,
          status: accountStatusFor(t.initialTournamentTokens, t.stakePerGame),
        })),
        now,
      );
      const started = await this.transition(uow, t, 'IN_PROGRESS', {
        startedAt: now,
        participants: paid.length,
        ...pool,
      });
      await uow.notify(
        paid.map(({ registration }) =>
          notice(registration.userId, 'TOURNAMENT_STARTED', started, `started:${id}`),
        ),
        now,
      );
      this.deps.logger.info('TOURNAMENT_STARTED', {
        tournamentId: id,
        participants: paid.length,
        grossPool: pool.grossPool,
        platformFee: pool.platformFee,
        prizePool: pool.prizePool,
      });
      return true;
    });
  }

  /**
   * Résultats : attend la fin des parties commencées avant la fin du tournoi (au plus
   * RESULTS_GRACE_MS), règle celles qui sont terminées, puis classe, calcule les gains et
   * fige les résultats (RESULTS_VALIDATED), en UNE transaction.
   */
  private async calculateResults(id: TournamentId): Promise<boolean> {
    await this.settlePendingGames(id);
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await uow.lockTournament(id);
      if (!t || t.status !== 'CALCULATING_RESULTS') return false;
      const now = this.clock();
      const playing = await uow.countActiveGames(id, t.endsAt);
      if (playing > 0 && now.getTime() < t.endsAt.getTime() + RESULTS_GRACE_MS) return false;
      // Poids figés à la publication, références issues des seuls paramètres du tournoi :
      // le classement ne dépend jamais des paramètres plateforme courants (D-062).
      const ranked = rankAccounts(
        await uow.listAccounts(id),
        rankingReferences(t),
        tournamentRankingWeights(t),
      );
      const { prizes, unallocated } = computePrizes(t.prizePool ?? 0, t.prizeRules, ranked.length);
      const prizeByRank = new Map(prizes.map((p) => [p.rank, p]));
      const rows: ResultDraft[] = ranked.map((a, index) => {
        const rank = index + 1;
        const prize = prizeByRank.get(rank);
        return {
          rank,
          shareBps: prize?.shareBps ?? 0,
          amount: prize?.amount ?? 0,
          playerId: a.playerId,
          initialTokens: a.initialTokens,
          remainingTokens: a.currentTokens,
          gamesPlayed: a.gamesPlayed,
          gamesWon: a.gamesWon,
          score: a.score,
        };
      });
      await uow.insertResults(id, rows, now);
      for (const [index, account] of ranked.entries()) {
        await uow.updateAccount(
          { ...account, rank: index + 1, prizeAmount: rows[index]!.amount },
          now,
        );
      }
      if (unallocated > 0) {
        await uow.recordPlatformEntry({
          tournamentId: id,
          kind: 'UNALLOCATED_PRIZE',
          amount: unallocated,
          now,
        });
      }
      await this.transition(uow, t, 'RESULTS_VALIDATED', {
        resultsAt: now,
        unallocatedPrize: unallocated,
      });
      this.deps.logger.info('TOURNAMENT_RESULTS_VALIDATED', {
        tournamentId: id,
        ranked: ranked.length,
        unallocated,
        playingAtCutoff: playing,
      });
      return true;
    });
  }

  /**
   * Verse UN gain non versé (une transaction, clé d'idempotence par rang) ; quand tout est
   * versé : COMPLETED et résultats annoncés à tous les participants.
   */
  private distributeOne(id: TournamentId): Promise<boolean> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await uow.lockTournament(id);
      if (!t || t.status !== 'DISTRIBUTING_PRIZES') return false;
      const now = this.clock();
      const [next] = await uow.lockUnpaidResults(id);
      if (next) {
        const { transactionId, credited } = await uow.creditPrize({
          userId: next.playerId,
          amount: next.amount,
          idempotencyKey: `tournament-prize:${id}:${next.rank}`,
          now,
        });
        await uow.markResultPaid(id, next.rank, transactionId, now);
        await uow.notify(
          [
            notice(next.playerId, 'TOURNAMENT_PRIZE_CREDITED', t, `prize:${id}:${next.rank}`, {
              rank: next.rank,
              amount: next.amount,
            }),
          ],
          now,
        );
        this.deps.logger.info('TOURNAMENT_PRIZE_PAID', {
          tournamentId: id,
          rank: next.rank,
          amount: next.amount,
          credited,
        });
        return true;
      }
      const accounts = await uow.listAccounts(id);
      const completed = await this.transition(uow, t, 'COMPLETED', { completedAt: now });
      await uow.notify(
        accounts.map((a) =>
          notice(a.playerId, 'TOURNAMENT_RESULTS_AVAILABLE', completed, `results:${id}`, {
            rank: a.rank,
            prizeAmount: a.prizeAmount,
          }),
        ),
        now,
      );
      this.deps.logger.info('TOURNAMENT_COMPLETED', { tournamentId: id });
      return true;
    });
  }

  // --- Parties : jetons de tournoi -------------------------------------------------------

  /**
   * Règle les jetons d'une partie TERMINÉE d'une table de tournoi (D-054), une seule fois
   * par `gameId`. Appelée à la fin de chaque partie et par la reprise du planificateur.
   */
  async settleGame(game: Game): Promise<void> {
    if (game.status !== 'finished' || !game.sessionId) return;
    const tournamentId = await this.deps.tournaments.findTournamentOfSession(game.sessionId);
    if (!tournamentId) return;
    const sessionId = game.sessionId;
    await this.deps.tournaments.transaction(async (uow) => {
      const t = await uow.lockTournament(tournamentId);
      if (!t) return;
      const now = this.clock();
      const base = {
        gameId: game.id,
        tournamentId,
        sessionId,
        stake: t.stakePerGame,
        pot: 0,
        transfers: {},
        settledAt: now,
      };
      const winnerId = game.result?.winnerId;
      const voidReason = !SETTLEABLE_STATUSES.includes(t.status)
        ? 'TOURNAMENT_NOT_IN_PROGRESS'
        : !game.startedAt || game.startedAt.getTime() >= t.endsAt.getTime()
          ? 'STARTED_AFTER_END'
          : !winnerId
            ? (game.endReason ?? 'NO_WINNER')
            : undefined;
      if (voidReason || !winnerId) {
        await uow.insertGameSettlement({ ...base, status: 'VOID', voidReason });
        return;
      }
      const accounts = await uow.lockAccounts(
        tournamentId,
        game.players.map((p) => p.playerId),
      );
      const winner = accounts.find((a) => a.playerId === (winnerId as string));
      if (!winner) {
        await uow.insertGameSettlement({
          ...base,
          status: 'VOID',
          voidReason: 'WINNER_NOT_PARTICIPANT',
        });
        return;
      }
      const { transfers, pot } = settleGameTokens(
        t.stakePerGame,
        winnerId,
        new Map(accounts.map((a) => [a.playerId as string, a.currentTokens])),
      );
      const inserted = await uow.insertGameSettlement({
        ...base,
        status: 'SETTLED',
        winnerId: winner.playerId,
        pot,
        transfers,
      });
      if (!inserted) return; // déjà réglée
      for (const account of accounts) {
        const currentTokens = account.currentTokens + (transfers[account.playerId] ?? 0);
        await uow.updateAccount(
          {
            ...account,
            currentTokens,
            gamesPlayed: account.gamesPlayed + 1,
            gamesWon: account.gamesWon + (account.playerId === winner.playerId ? 1 : 0),
            status: accountStatusFor(currentTokens, t.stakePerGame),
          },
          now,
        );
      }
      this.deps.logger.info('TOURNAMENT_GAME_SETTLED', {
        tournamentId,
        gameId: game.id,
        winnerId,
        pot,
      });
    });
  }

  /**
   * Écouteur de fin de partie (GameService.onGameFinished) : règlement en arrière-plan. Un
   * échec est journalisé ; la reprise du planificateur règlera la partie.
   */
  observeFinishedGame(game: Game): void {
    this.background.run(() =>
      this.settleGame(game).catch((err: unknown) =>
        this.deps.logger.error('tournament game settlement failed', {
          gameId: game.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }

  /** Attend la fin des règlements lancés en arrière-plan (arrêt, tests). */
  idle(): Promise<void> {
    return this.background.idle();
  }

  /** Reprise : règle les parties terminées non encore réglées (toutes, ou d'un tournoi). */
  async settlePendingGames(only?: TournamentId): Promise<number> {
    let settled = 0;
    for (const { gameId, tournamentId } of await this.deps.tournaments.findUnsettledFinishedGames(
      200,
    )) {
      if (only && tournamentId !== only) continue;
      const game = await this.deps.games.findGame(gameId);
      if (game) {
        await this.settleGame(game);
        settled += 1;
      }
    }
    return settled;
  }

  // --- Rejoindre une table ---------------------------------------------------------------

  /**
   * Attribue une table du tournoi EN COURS au participant (D-051, D-054, D-065) : déjà assis
   * → cette table ; sinon une table en attente avec un siège libre, la PLUS REMPLIE d'abord
   * (puis la plus ancienne) pour que les parties démarrent au plus vite ; sinon une nouvelle
   * (capacité 4, le joueur en est le créateur et le responsable du démarrage). Déterministe :
   * aucun tirage aléatoire.
   */
  async join(id: TournamentId, userId: UserId, meta: CallMeta = {}): Promise<TournamentSeat> {
    const playerId = playerIdOf(userId);
    const log = this.log(id, userId, 'TOURNAMENT_JOIN', meta);
    try {
      await this.advance(id);
      const seat = await this.joinQueue.run(id, () => this.assignTable(id, playerId, meta));
      log.info('TOURNAMENT_JOINED', { sessionId: seat.sessionId, gameId: seat.gameId });
      return seat;
    } catch (err) {
      log.warn('tournament join rejected', { errorName: errorName(err) });
      throw err;
    }
  }

  /**
   * Accès direct à une session (POST /api/sessions/:id/join) : une table de tournoi n'admet
   * qu'un participant du tournoi en cours, au-dessus du seuil de participation (D-063).
   */
  async isAdmitted(sessionId: SessionId, playerId: PlayerId): Promise<boolean> {
    const tournamentId = await this.deps.tournaments.findTournamentOfSession(sessionId);
    if (!tournamentId) return true;
    const t = await this.deps.tournaments.findById(tournamentId);
    if (!t || t.status !== 'IN_PROGRESS' || this.clock().getTime() >= t.endsAt.getTime()) {
      return false;
    }
    await this.settlePendingGames(tournamentId);
    const account = await this.deps.tournaments.findAccount(tournamentId, playerId);
    return account !== null && canPlayTournamentGame(account.currentTokens, t.stakePerGame);
  }

  private async assignTable(
    id: TournamentId,
    playerId: PlayerId,
    meta: CallMeta,
  ): Promise<TournamentSeat> {
    const t = await this.load(id);
    const now = this.clock();
    if (t.status === 'CANCELLED') throw new TournamentCancelledError(id);
    if (PRE_CAPTURE_STATUSES.includes(t.status)) throw new TournamentNotStartedError(id);
    if (t.status !== 'IN_PROGRESS' || now.getTime() >= t.endsAt.getTime()) {
      throw new TournamentCompletedError(id);
    }
    // Jetons à jour : une partie tout juste terminée est réglée AVANT la lecture du solde
    // (sinon un départ rapide de la table laisserait lire l'ancien solde). Idempotent.
    await this.settlePendingGames(id);
    const account = await this.deps.tournaments.findAccount(id, playerId);
    if (!account) throw new NotRegisteredError(id);

    // Une seule session active par joueur (D-034, R-18).
    for (const session of await this.deps.sessions.findActiveSessions(playerId)) {
      if ((await this.deps.tournaments.findTournamentOfSession(session.id)) === id) {
        const seat = await this.deps.sessions.getSession(session.id, playerId);
        // Déjà dans la partie en cours (reconnexion) : jamais refusé, ses jetons n'ont pas
        // bougé depuis son début. Sinon (rejoindre la partie suivante) : seuil exigé.
        const playing =
          seat.lastGame?.status === 'in_progress' && seat.lastGame.playerIds.includes(playerId);
        if (!playing && !canPlayTournamentGame(account.currentTokens, t.stakePerGame)) {
          throw new TournamentOutOfTokensError(id);
        }
        return this.seatAt(id, session.id, playerId);
      }
      throw new PlayerAlreadyInSessionError(playerId);
    }
    if (!canPlayTournamentGame(account.currentTokens, t.stakePerGame)) {
      throw new TournamentOutOfTokensError(id);
    }

    // Rejoindre une table existante ; sinon en ouvrir une. L'ouverture est revérifiée sous
    // verrou du tournoi : si une autre instance vient d'en ouvrir une, on rejoint celle-ci.
    for (let attempt = 0; attempt < TABLE_ATTEMPTS; attempt += 1) {
      for (const sessionId of await this.deps.tournaments.findJoinableSessions(
        id,
        JOIN_CANDIDATES,
      )) {
        const seat = await this.tryTable(id, sessionId, playerId, meta);
        if (seat) return seat;
      }
      try {
        return await this.openTable(t, playerId, meta);
      } catch (err) {
        if (err instanceof TournamentTableRefusedError) throw new TournamentCompletedError(id);
        if (!(err instanceof TournamentTableAvailableError)) throw err;
      }
    }
    throw new TournamentBusyError(id);
  }

  private async tryTable(
    id: TournamentId,
    sessionId: SessionId,
    playerId: PlayerId,
    meta: CallMeta,
  ): Promise<TournamentSeat | undefined> {
    try {
      await this.deps.sessions.joinSession(sessionId, playerId, meta);
    } catch (err) {
      if (err instanceof SessionFullError || err instanceof SessionClosedError) return undefined;
      throw err;
    }
    try {
      return await this.seatAt(id, sessionId, playerId);
    } catch (err) {
      // Échec après la place de session (partie démarrée ou pleine, ou toujours en conflit) :
      // le joueur ne reste jamais assis sans jouer.
      await this.deps.sessions.leaveSession(sessionId, playerId, meta).catch((leaveErr: unknown) =>
        this.deps.logger.error('tournament table release failed', {
          tournamentId: id,
          sessionId,
          error: leaveErr instanceof Error ? leaveErr.message : String(leaveErr),
        }),
      );
      // Partie démarrée (y compris entre la recherche de la table et l'arrivée) ou pleine :
      // on essaie la table suivante, ou on en ouvre une.
      if (
        err instanceof GameFullError ||
        err instanceof GameNotJoinableError ||
        err instanceof TournamentGameInProgressError
      ) {
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Nouvelle table : session de 4 places, sans mise réelle, dont le joueur est le créateur.
   * Création ET rattachement au tournoi dans UNE transaction (jamais de table ordinaire
   * intermédiaire, jamais visible dans les tables ouvertes). Démarrage automatique 10 s
   * après l'arrivée du 2e joueur (D-065, D-068).
   */
  private async openTable(
    t: Tournament,
    playerId: PlayerId,
    meta: CallMeta,
  ): Promise<TournamentSeat> {
    const { session, game } = await this.deps.sessions.createSession(
      playerId,
      {
        maxPlayers: TOURNAMENT_TABLE_SIZE,
        creationKey: `tournament:${randomUUID()}`,
        name: tournamentLabel(t.startsAt, t.timezone).slice(0, SESSION_NAME_MAX_LENGTH).trim(),
        tournamentId: t.id,
        autoStartDelayMs: TOURNAMENT_TABLE_AUTO_START_MS,
      },
      meta,
    );
    return { tournamentId: t.id, sessionId: session.id, gameId: game.id };
  }

  /** Partie à ouvrir pour un joueur assis à la table (rejoint la partie en attente). */
  private async seatAt(
    id: TournamentId,
    sessionId: SessionId,
    playerId: PlayerId,
  ): Promise<TournamentSeat> {
    // Les places de session sont sérialisées par le verrou de la session, mais l'entrée dans
    // la partie ne l'est que par instance (file de la partie) ; entre instances, la version
    // optimiste fait perdre l'une des deux écritures. Le perdant relit la table et réévalue
    // (même schéma que handleTurnTimeout / handleStartDeadline) : déjà assis, partie pleine
    // ou démarrée entre-temps reprennent les branches ci-dessous.
    for (let attempt = 1; ; attempt++) {
      const { lastGame } = await this.deps.sessions.getSession(sessionId, playerId);
      if (!lastGame) throw new TournamentGameInProgressError(sessionId);
      try {
        if (lastGame.status === 'waiting' && !lastGame.playerIds.includes(playerId)) {
          await this.deps.games.joinGame(lastGame.gameId, playerId);
        } else if (lastGame.status === 'in_progress' && !lastGame.playerIds.includes(playerId)) {
          throw new TournamentGameInProgressError(sessionId);
        }
        return { tournamentId: id, sessionId, gameId: lastGame.gameId };
      } catch (err) {
        if (!(err instanceof GameVersionConflictError)) throw err;
        if (attempt >= SEAT_ATTEMPTS) throw new TournamentBusyError(id);
      }
    }
  }

  // --- Lectures --------------------------------------------------------------------------

  /** Prochain tournoi à venir auquel le joueur est inscrit (D-059), sur l'horloge serveur. */
  nextRegistered(userId: UserId): Promise<Tournament | null> {
    return this.deps.tournaments.findNextRegistered(userId, this.clock());
  }

  /**
   * Liste des tournois pour un joueur (D-065), vue par le serveur : publiés non terminés
   * (début le plus proche d'abord), puis l'historique récent. Chaque tournoi en cours ou à
   * venir est d'abord avancé (transitions dues appliquées) : un tournoi commencé n'est jamais
   * présenté « à venir ».
   */
  async listForPlayer(
    viewerId: UserId,
  ): Promise<{ current: TournamentSnapshot[]; history: TournamentSnapshot[]; now: Date }> {
    for (const t of await this.deps.tournaments.listPublished({
      scope: 'current',
      limit: LIST_CURRENT_LIMIT,
    })) {
      await this.advance(t.id);
    }
    const now = this.clock();
    const [current, history] = await Promise.all([
      this.deps.tournaments.listPublished({ scope: 'current', limit: LIST_CURRENT_LIMIT }),
      this.deps.tournaments.listPublished({
        scope: 'history',
        limit: LIST_HISTORY_LIMIT,
        visibleSince: new Date(now.getTime() - LIST_HISTORY_VISIBILITY_MS),
      }),
    ]);
    return {
      current: await Promise.all(current.map((t) => this.snapshot(t, viewerId))),
      history: await Promise.all(history.map((t) => this.snapshot(t, viewerId))),
      now,
    };
  }

  /** Tournoi à afficher (en cours, sinon à venir, sinon terminé ou annulé récemment). */
  async getFeatured(viewerId: UserId): Promise<TournamentSnapshot | null> {
    const now = this.clock();
    const since = new Date(now.getTime() - RECENT_TOURNAMENT_VISIBILITY_MS);
    const found = await this.deps.tournaments.findFeatured(now, since);
    if (!found) return null;
    await this.advance(found.id);
    const fresh = await this.deps.tournaments.findFeatured(this.clock(), since);
    return fresh ? this.snapshot(fresh, viewerId) : null;
  }

  /**
   * Détail d'un tournoi. Un tournoi jamais publié (brouillon, proposition en attente, refusée
   * ou retirée) n'est visible que de son créateur et de l'administration : pour tout autre
   * compte il « n'existe pas » (404), sans révéler son existence (D-056).
   */
  async getTournament(
    id: TournamentId,
    viewerId: UserId,
    { isAdmin = false }: { isAdmin?: boolean } = {},
  ): Promise<TournamentSnapshot> {
    const t = await this.loadVisible(id, viewerId, isAdmin);
    if (!TOKEN_SETUP_STATUSES.includes(t.status)) return this.snapshot(t, viewerId);
    const settings = await this.deps.tournaments.readSettings();
    return {
      ...(await this.snapshot(withTokenSetup(t, settings), viewerId)),
      tokenCoefficients: {
        initialTokensCoefficient: settings.initialTokensCoefficient,
        stakePerGameCoefficient: settings.stakePerGameCoefficient,
      },
    };
  }

  /** Classement en direct (pendant le tournoi) ou final. */
  async standings(id: TournamentId, viewerId: UserId, { isAdmin = false } = {}) {
    const t = await this.loadVisible(id, viewerId, isAdmin);
    if (RESULT_STATUSES.includes(t.status)) {
      return { tournament: t, live: false, rows: await this.deps.tournaments.listResults(id) };
    }
    const ranked = rankAccounts(
      await this.deps.tournaments.listAccountsWithNames(id),
      rankingReferences(t),
      tournamentRankingWeights(t),
    );
    return {
      tournament: t,
      live: true,
      rows: ranked.map((a, index) => ({
        tournamentId: id,
        rank: index + 1,
        playerId: a.playerId,
        username: a.username,
        initialTokens: a.initialTokens,
        remainingTokens: a.currentTokens,
        gamesPlayed: a.gamesPlayed,
        gamesWon: a.gamesWon,
        score: a.score,
        prizeShareBps: 0,
        prizeAmount: 0,
      })),
    };
  }

  /** Résultats officiels (figés). */
  async results(
    id: TournamentId,
  ): Promise<{ tournament: Tournament; rows: TournamentResultRow[] }> {
    const t = await this.load(id);
    if (!RESULT_STATUSES.includes(t.status)) throw new TournamentResultsUnavailableError(id);
    return { tournament: t, rows: await this.deps.tournaments.listResults(id) };
  }

  async listForAdmin(statuses?: TournamentStatus[]): Promise<AdminTournamentListItem[]> {
    const [items, settings] = await Promise.all([
      this.deps.tournaments.listForAdmin({ ...(statuses && { statuses }), limit: 100 }),
      this.deps.tournaments.readSettings(),
    ]);
    return items.map((item) => ({
      ...item,
      tournament: withTokenSetup(item.tournament, settings),
    }));
  }

  async listMine(userId: UserId): Promise<Tournament[]> {
    const [list, settings] = await Promise.all([
      this.deps.tournaments.list({ creatorId: userId, limit: 50 }),
      this.deps.tournaments.readSettings(),
    ]);
    return list.map((t) => withTokenSetup(t, settings));
  }

  async registrations(id: TournamentId): Promise<RegistrationListItem[]> {
    await this.load(id);
    return this.deps.tournaments.listRegistrations(id);
  }

  // --- Paramètres plateforme ---------------------------------------------------------------

  getSettings(): Promise<TournamentSettings> {
    return this.deps.tournaments.readSettings();
  }

  /**
   * Règles de création d'un tournoi lisibles par tout joueur connecté (D-103, D-104) : bornes
   * du nombre de joueurs (maximum `null` = ∞) et de la durée en minutes, réglées dans les
   * Paramètres des tournois. Le serveur les applique lui-même ; l'application s'en sert pour
   * ses valeurs par défaut et un retour immédiat.
   */
  async getCreationRules(): Promise<{
    minimumPlayers: number;
    maximumPlayers: number | null;
    minimumDurationMinutes: number;
    maximumDurationMinutes: number;
    /** Prix d'entrée minimal (FCFA, D-105) et maximal (plateforme). */
    minimumEntryFee: number;
    maximumEntryFee: number;
  }> {
    const s = await this.deps.tournaments.readSettings();
    return {
      minimumPlayers: s.tournamentMinimumPlayers,
      maximumPlayers: s.tournamentMaximumPlayers,
      minimumDurationMinutes: s.tournamentMinimumDurationMinutes,
      maximumDurationMinutes: s.tournamentMaximumDurationMinutes,
      minimumEntryFee: s.tournamentMinimumEntryFee,
      maximumEntryFee: TOURNAMENT_LIMITS.maxEntryFee,
    };
  }

  /**
   * Les tournois déjà publiés gardent le taux, les poids de classement, les jetons de départ
   * et la mise copiés à leur publication. Les deux poids sont validés ensemble (somme
   * exactement 100 %), les deux coefficients aussi (mise ≤ moitié des jetons, D-071).
   */
  updateSettings(adminId: UserId, patch: Partial<TournamentSettings>): Promise<TournamentSettings> {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch) as [keyof TournamentSettings, unknown][]) {
      const limits = SETTINGS_LIMITS[key];
      if (!limits) {
        fields[key] = 'Paramètre inconnu.';
        continue;
      }
      // Maximum de joueurs : `null` = aucun plafond (∞).
      if (key === 'tournamentMaximumPlayers' && value === null) continue;
      const coefficient = (COEFFICIENT_SETTING_KEYS as readonly string[]).includes(key);
      const integer = key !== 'platformFeePercent' && !coefficient;
      const ok =
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (integer
          ? Number.isSafeInteger(value)
          : coefficient
            ? coefficientHundredths(value) !== undefined
            : Number.isInteger(value * 100)) &&
        value >= limits.min &&
        value <= limits.max;
      if (!ok) fields[key] = `Entre ${limits.min} et ${limits.max}.`;
    }
    if (Object.keys(fields).length > 0) return Promise.reject(new InvalidTournamentError(fields));
    return this.deps.tournaments.transaction(async (uow) => {
      const now = this.clock();
      const current = await uow.readSettings();
      const next = { ...current, ...stripUndefined(patch) };
      const weightsError = rankingWeightsError(rankingWeightsOf(next));
      if (weightsError) {
        const keys = WEIGHT_SETTING_KEYS.filter((k) => patch[k] !== undefined);
        throw new InvalidTournamentError(
          Object.fromEntries(
            (keys.length > 0 ? keys : WEIGHT_SETTING_KEYS).map((k) => [k, weightsError]),
          ),
        );
      }
      const coefficientsError = tokenCoefficientsError(next);
      if (coefficientsError) {
        throw new InvalidTournamentError({ stakePerGameCoefficient: coefficientsError });
      }
      const playersError = playerLimitsError(next);
      if (playersError) {
        throw new InvalidTournamentError({ tournamentMaximumPlayers: playersError });
      }
      const durationError = durationLimitsError(next);
      if (durationError) {
        throw new InvalidTournamentError({ tournamentMaximumDurationMinutes: durationError });
      }
      await uow.writeSettings(next, adminId, now);
      await uow.audit({
        actorId: adminId,
        action: 'TOURNAMENT_SETTINGS_UPDATED',
        details: { from: current, to: next },
        now,
      });
      return next;
    });
  }

  // --- Interne -----------------------------------------------------------------------------

  private async snapshot(t: Tournament, viewerId: UserId): Promise<TournamentSnapshot> {
    const [registeredCount, registration, account, results] = await Promise.all([
      this.deps.tournaments.countActiveRegistrations(t.id),
      this.deps.tournaments.findRegistration(t.id, viewerId),
      this.deps.tournaments.findAccount(t.id, viewerId),
      RESULT_STATUSES.includes(t.status)
        ? this.deps.tournaments.listResults(t.id)
        : Promise.resolve([]),
    ]);
    const reservation = registration
      ? await this.deps.tournaments.findActiveReservation(registration.id)
      : null;
    return {
      tournament: t,
      registeredCount,
      registration,
      reservation,
      account,
      podium: results.slice(0, 3),
      now: this.clock(),
    };
  }

  private async simpleTransition(
    id: TournamentId,
    from: TournamentStatus,
    to: TournamentStatus,
  ): Promise<boolean> {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await uow.lockTournament(id);
      if (!t || t.status !== from) return false;
      await this.transition(uow, t, to, {});
      this.deps.logger.info('TOURNAMENT_STATUS', { tournamentId: id, from, to });
      return true;
    });
  }

  private cancelIfStatus(id: TournamentId, from: TournamentStatus, reason: CancellationReason) {
    return this.deps.tournaments.transaction(async (uow) => {
      const t = await uow.lockTournament(id);
      if (!t || t.status !== from) return false;
      await this.cancelInTx(uow, t, reason, this.clock());
      this.deps.logger.info('TOURNAMENT_CANCELLED', { tournamentId: id, reason });
      return true;
    });
  }

  /** Annulation sur la ligne verrouillée : libère TOUTES les réservations actives. */
  private async cancelInTx(
    uow: TournamentUnitOfWork,
    t: Tournament,
    reason: CancellationReason,
    now: Date,
  ): Promise<Tournament> {
    const active = await uow.listActiveRegistrations(t.id);
    for (const { reservation } of active) {
      if (reservation?.status === 'ACTIVE') await uow.release(reservation.id, now);
    }
    const cancelled = await this.transition(uow, t, 'CANCELLED', {
      cancellationReason: reason,
      cancelledAt: now,
    });
    const recipients = new Set<UserId>(active.map((a) => a.registration.userId));
    if (reason === 'APPROVAL_REJECTED' && t.creatorId) recipients.add(t.creatorId);
    await uow.notify(
      [...recipients].map((userId) =>
        notice(userId, 'TOURNAMENT_CANCELLED', cancelled, `cancelled:${t.id}`, { reason }),
      ),
      now,
    );
    return cancelled;
  }

  /** Seul passage d'un état à un autre : transition vérifiée, version incrémentée. */
  private transition(
    uow: TournamentUnitOfWork,
    t: Tournament,
    to: TournamentStatus,
    patch: Partial<Tournament>,
  ): Promise<Tournament> {
    assertTransition(t.id, t.status, to);
    return uow.saveTournament({ ...t, ...patch, status: to, updatedAt: this.clock() });
  }

  private async lock(uow: TournamentUnitOfWork, id: TournamentId): Promise<Tournament> {
    const t = await uow.lockTournament(id);
    if (!t) throw new TournamentNotFoundError(id);
    return t;
  }

  private async loadVisible(
    id: TournamentId,
    viewerId: UserId,
    isAdmin: boolean,
  ): Promise<Tournament> {
    const t = await this.load(id);
    if (!t.publishedAt && !isAdmin && t.creatorId !== viewerId) {
      throw new TournamentNotFoundError(id);
    }
    return t;
  }

  private async load(id: TournamentId): Promise<Tournament> {
    const t = await this.deps.tournaments.findById(id);
    if (!t) throw new TournamentNotFoundError(id);
    return t;
  }

  private log(id: TournamentId, userId: UserId, action: string, meta: CallMeta) {
    return this.deps.logger.child({
      tournamentId: id,
      playerId: userId,
      action,
      requestId: meta.requestId,
    });
  }
}

// --- Fonctions pures d'assemblage ----------------------------------------------------------

function draftOf(
  valid: ReturnType<typeof validateTournamentInput>,
  creatorType: CreatorType,
  creatorId: UserId,
  now: Date,
): Tournament {
  return {
    id: newTournamentId(),
    version: 1,
    status: 'DRAFT',
    creatorType,
    creatorId,
    currency: 'XAF',
    ...fieldsOf(valid),
    createdAt: now,
    updatedAt: now,
  };
}

function fieldsOf(valid: ReturnType<typeof validateTournamentInput>) {
  return {
    timezone: valid.timezone,
    startsAt: valid.startsAt,
    endsAt: valid.endsAt,
    registrationOpensAt: valid.registrationOpensAt,
    registrationClosesAt: valid.registrationClosesAt,
    entryFee: valid.entryFee,
    minimumPlayers: valid.minimumPlayers,
    maximumPlayers: valid.maximumPlayers,
    initialTournamentTokens: valid.initialTournamentTokens,
    stakePerGame: valid.stakePerGame,
    prizeRules: valid.prizeRules,
  };
}

function tokensOf(t: TournamentTokenSetup): TournamentTokenSetup {
  return { initialTournamentTokens: t.initialTournamentTokens, stakePerGame: t.stakePerGame };
}

/**
 * Tournoi non publié : jetons de départ et mise relus avec les coefficients EN VIGUEUR (D-071),
 * pour l'affichage ; l'approbation les recalcule et les fige. Publié : inchangé (figé).
 */
function withTokenSetup(t: Tournament, settings: TournamentSettings): Tournament {
  if (!TOKEN_SETUP_STATUSES.includes(t.status)) return t;
  return { ...t, ...tournamentTokenSetup(t.entryFee, settings) };
}

function inputOf(t: Tournament): TournamentInput {
  return {
    timezone: t.timezone,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    registrationOpensAt: t.registrationOpensAt,
    registrationClosesAt: t.registrationClosesAt,
    entryFee: t.entryFee,
    minimumPlayers: t.minimumPlayers,
    maximumPlayers: t.maximumPlayers,
    prizeRules: t.prizeRules,
  };
}

/**
 * Délai minimal d'une proposition de joueur (D-054), revérifié à la soumission ET à
 * l'approbation (D-056) : le début doit rester au moins 1 h plus tard. Un tournoi créé par
 * l'administration doit seulement commencer dans le futur.
 */
function assertPlayerLeadTime(t: Tournament, now: Date): void {
  const lead = t.creatorType === 'PLAYER' ? TOURNAMENT_LIMITS.playerMinLeadMs : 0;
  if (t.startsAt.getTime() <= now.getTime() + lead) {
    throw new InvalidTournamentError({
      startsAt:
        t.creatorType === 'PLAYER'
          ? 'Le tournoi doit commencer au moins 1 h plus tard.'
          : 'Le début est déjà passé.',
    });
  }
}

/**
 * Au plus `maxWaitingTournaments` tournois aux inscriptions ouvertes ou à ouvrir sur la
 * plateforme (D-059, comptage D-072), sous le verrou de planification.
 */
async function assertWaitingCapacity(uow: TournamentUnitOfWork): Promise<void> {
  const limit = TOURNAMENT_LIMITS.maxWaitingTournaments;
  if ((await uow.countWaitingTournaments()) >= limit) {
    throw new TooManyWaitingTournamentsError(limit);
  }
}

function blockedUntil(endsAt: Date, settings: TournamentSettings): Date {
  return new Date(endsAt.getTime() + settings.tournamentTransitionMinutes * 60_000);
}

/** Publication : taux de commission et poids du classement COPIÉS (immuables ensuite), créneau réservé. */
function publish(t: Tournament, settings: TournamentSettings, now: Date, by: UserId): Tournament {
  return {
    ...t,
    status: 'SCHEDULED',
    platformFeeBps: percentToBps(settings.platformFeePercent),
    rankingWeights: rankingWeightsOf(settings),
    publishedAt: now,
    approvedBy: by,
    blockedUntil: blockedUntil(t.endsAt, settings),
    registrationClosesAt: t.registrationClosesAt ?? t.startsAt,
    updatedAt: now,
  };
}

/** Fenêtre d'inscription : statut ET horloge (le planificateur peut avoir un tick de retard). */
function registrationWindowOpen(t: Tournament, now: Date): boolean {
  const at = now.getTime();
  return (
    t.status === 'REGISTRATION_OPEN' &&
    at >= (t.registrationOpensAt ?? t.publishedAt ?? now).getTime() &&
    at < (t.registrationClosesAt ?? t.startsAt).getTime()
  );
}

function notice(
  userId: UserId,
  type: NotificationDraft['type'],
  t: Tournament,
  dedupeKey: string,
  extra: Record<string, unknown> = {},
): NotificationDraft {
  return {
    userId,
    type,
    dedupeKey,
    payload: { tournamentId: t.id, startsAt: t.startsAt.toISOString(), ...extra },
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export type { TournamentInput };
