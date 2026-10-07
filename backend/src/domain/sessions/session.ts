import { randomUUID } from 'node:crypto';

import { ALLOWED_MAX_PLAYERS } from '../game/game';
import { InvalidPlayerCountError } from '../game/game-errors';
import type { GameEndReason } from '../game/game';
import type { GameId, PlayerId } from '../game/game-id';
import type { SessionEventDraft } from './session-events';

/**
 * SESSION (D-033, D-034) : une table de jeu persistante sur laquelle se succèdent
 * plusieurs parties (Game). La session orchestre le CONTEXTE : capacité, joueurs
 * présents, sièges fixes, parties successives, premier joueur (J1) de chaque partie,
 * décision Poursuivre/Quitter entre deux parties, ouverture/fermeture.
 * Le jeu lui-même (cartes, tours, contrôle, gagnant) appartient à la Game.
 */
export type SessionId = string & { readonly __brand: 'SessionId' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSessionId(value: unknown): value is SessionId {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function newSessionId(): SessionId {
  return randomUUID() as SessionId;
}

/** OPEN : on peut la rejoindre et y créer des parties. CLOSED : historique seulement. */
export type SessionStatus = 'open' | 'closed';

/** Délai pour choisir Poursuivre ou Quitter après une partie (D-034). */
export const SESSION_DECISION_WINDOW_MS = 10_000;

/**
 * Présence d'un joueur dans la session. `seat` est son siège FIXE à la table
 * (0 … maxPlayers-1) ; l'ordre des sièges croissants est le sens ANTIHORAIRE du jeu.
 * Les sièges ne tournent jamais, même quand J1 change (D-034). Pour un joueur parti,
 * `seat` est le dernier siège qu'il occupait : ce siège est VACANT.
 */
export interface SessionPlayer {
  playerId: PlayerId;
  seat: number;
  joinedAt: Date;
  active: boolean;
  leftAt?: Date;
}

/** Choix d'un joueur entre deux parties. `auto_leave` : aucune réponse à l'échéance. */
export type DecisionChoice = 'continue' | 'leave' | 'auto_leave';

export interface PlayerDecision {
  choice: DecisionChoice;
  decidedAt: Date;
}

/**
 * Ronde de décision ouverte par la fin d'une partie (D-034) : chaque joueur présent a
 * SESSION_DECISION_WINDOW_MS pour choisir Poursuivre ou Quitter. Elle est résolue quand
 * tous les présents ont choisi Poursuivre, ou à l'échéance : les joueurs sans réponse
 * quittent alors automatiquement la session (siège vacant).
 */
export interface DecisionRound {
  gameId: GameId;
  openedAt: Date;
  deadlineAt: Date;
  resolvedAt?: Date;
  /** Clé = playerId. */
  decisions: Record<string, PlayerDecision>;
}

export interface Session {
  id: SessionId;
  /** Incrémentée à chaque changement : ordre des événements de la session. */
  version: number;
  status: SessionStatus;
  creatorId: PlayerId;
  /** 2, 3 ou 4, choisi à la création, immuable (garanti aussi en base). */
  maxPlayers: number;
  /** Tous les joueurs passés par la session, actifs ou partis. */
  players: SessionPlayer[];
  /** Dernière ronde de décision (ouverte ou résolue), absente avant la 1re fin de partie. */
  round?: DecisionRound;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
}

/** Dernière partie de la session (la plus récente), lue sous verrou de la session. */
export interface LastGameInfo {
  gameId: GameId;
  status: 'waiting' | 'in_progress' | 'finished';
  finishedAt?: Date;
  /** Raison de la fin (INSTANT_WIN_TIE : reprise immédiate, pas de Poursuivre/Quitter). */
  endReason?: GameEndReason;
  /** J1 de cette partie (repris tel quel par la partie qui la rejoue, décision 23). */
  firstPlayerId: PlayerId;
  winnerId?: PlayerId;
  /** Siège du gagnant dans cette partie (copie figée de son siège de session). */
  winnerSeat?: number;
  /** Joueurs de la partie (ceux qui ont reçu des cartes, ou attendent le démarrage). */
  playerIds: PlayerId[];
}

/** Résumé d'une partie de la session (historique), sans aucune carte. */
export interface SessionGameSummary {
  gameId: string;
  status: 'waiting' | 'in_progress' | 'finished';
  creatorId: PlayerId;
  firstPlayerId?: PlayerId;
  winnerId?: PlayerId;
  /** Raison de la fin (victoire, égalité de priorité rejouée, arrêt administratif). */
  endReason?: GameEndReason;
  /** Partie annulée pour égalité que celle-ci rejoue. */
  replayOfGameId?: string;
  maxPlayers: number;
  playerIds: PlayerId[];
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
}

/** Résultat d'une transition : la session (inchangée si `events` est vide) et ses événements. */
export interface SessionTransition {
  session: Session;
  events: SessionEventDraft[];
}

export function assertAllowedMaxPlayers(maxPlayers: number): void {
  if (!(ALLOWED_MAX_PLAYERS as readonly number[]).includes(maxPlayers)) {
    throw new InvalidPlayerCountError(maxPlayers);
  }
}

/** Nouvelle session : ouverte, capacité fixée, son créateur au siège 0. */
export function newSession(creatorId: PlayerId, maxPlayers: number, now: Date): Session {
  assertAllowedMaxPlayers(maxPlayers);
  return {
    id: newSessionId(),
    version: 1,
    status: 'open',
    creatorId,
    maxPlayers,
    players: [{ playerId: creatorId, seat: 0, joinedAt: now, active: true }],
    createdAt: now,
    updatedAt: now,
  };
}

export function activeSessionPlayers(session: Session): SessionPlayer[] {
  return session.players.filter((p) => p.active).sort((a, b) => a.seat - b.seat);
}

export function isActiveSessionMember(session: Session, playerId: PlayerId): boolean {
  return session.players.some((p) => p.playerId === playerId && p.active);
}

/** Occupant actuel de chaque siège (undefined = siège vacant), index = siège. */
export function seatMap(session: Session): (PlayerId | undefined)[] {
  const seats: (PlayerId | undefined)[] = Array.from(
    { length: session.maxPlayers },
    () => undefined,
  );
  for (const p of activeSessionPlayers(session)) {
    seats[p.seat] = p.playerId;
  }
  return seats;
}

export function isRoundOpen(session: Session): boolean {
  return Boolean(session.round && !session.round.resolvedAt);
}

/** Joueurs présents qui n'ont pas encore répondu à la ronde ouverte. */
export function pendingDecisions(session: Session): PlayerId[] {
  const round = session.round;
  if (!round || round.resolvedAt) {
    return [];
  }
  return activeSessionPlayers(session)
    .map((p) => p.playerId)
    .filter((id) => !round.decisions[id]);
}

// --- Transitions (pures : le dépôt les applique sous verrou de la session) --------------

function bump(session: Session, now: Date): Session {
  return { ...session, version: session.version + 1, updatedAt: now };
}

/** Retire le joueur (siège vacant) ; ferme la session si plus personne n'est présent. */
function removePlayer(
  session: Session,
  playerId: PlayerId,
  now: Date,
  reason: 'leave' | 'auto_leave',
): SessionTransition {
  const players = session.players.map((p) =>
    p.playerId === playerId ? { ...p, active: false, leftAt: now } : p,
  );
  const seat = session.players.find((p) => p.playerId === playerId)?.seat;
  const closed = !players.some((p) => p.active);
  const events: SessionEventDraft[] = [
    { type: 'session:player_left', payload: { playerId, seat, reason } },
  ];
  if (closed) {
    events.push({ type: 'session:closed' });
  }
  return {
    session: {
      ...session,
      players,
      ...(closed && { status: 'closed' as const, closedAt: now }),
    },
    events,
  };
}

/**
 * Met la ronde de décision à jour par rapport à la dernière partie et à l'heure :
 *
 * 1. la dernière partie est terminée et n'a pas encore de ronde → ouverture. L'échéance
 *    vaut fin de la partie + 10 s : elle est la même quel que soit le processus qui ouvre
 *    la ronde (événement de fin, reprise après redémarrage, balayage) ;
 * 2. ronde ouverte et échéance atteinte → les joueurs sans réponse QUITTENT
 *    automatiquement (siège vacant), puis la ronde est résolue ;
 * 3. ronde ouverte et tous les présents ont choisi Poursuivre → résolue.
 *
 * Idempotente : sans changement à faire, renvoie la session telle quelle, sans événement.
 */
export function syncDecisionRound(
  session: Session,
  lastGame: LastGameInfo | null,
  now: Date,
  windowMs: number = SESSION_DECISION_WINDOW_MS,
): SessionTransition {
  let current = session;
  const events: SessionEventDraft[] = [];

  if (
    current.status === 'open' &&
    lastGame?.status === 'finished' &&
    lastGame.finishedAt &&
    // Égalité de priorité : reprise immédiate, SANS Poursuivre/Quitter (décision 17).
    lastGame.endReason !== 'INSTANT_WIN_TIE' &&
    current.round?.gameId !== lastGame.gameId
  ) {
    const openedAt = lastGame.finishedAt;
    const deadlineAt = new Date(openedAt.getTime() + windowMs);
    current = {
      ...current,
      round: { gameId: lastGame.gameId, openedAt, deadlineAt, decisions: {} },
    };
    events.push({
      type: 'session:decision_started',
      payload: {
        gameId: lastGame.gameId,
        deadlineAt: deadlineAt.toISOString(),
        playerIds: activeSessionPlayers(current).map((p) => p.playerId),
      },
    });
  }

  const resolved = resolveIfComplete(current, now);
  current = resolved.session;
  events.push(...resolved.events);

  return { session: events.length > 0 ? bump(current, now) : session, events };
}

/** Résout la ronde ouverte si tout le monde a répondu ou si l'échéance est atteinte. */
function resolveIfComplete(session: Session, now: Date): SessionTransition {
  const round = session.round;
  if (!round || round.resolvedAt) {
    return { session, events: [] };
  }
  const pending = pendingDecisions(session);
  const expired = now.getTime() >= round.deadlineAt.getTime();
  if (pending.length > 0 && !expired) {
    return { session, events: [] };
  }

  let current: Session = { ...session, round: { ...round, decisions: { ...round.decisions } } };
  const events: SessionEventDraft[] = [];
  for (const playerId of pending) {
    (current.round as DecisionRound).decisions[playerId] = { choice: 'auto_leave', decidedAt: now };
    events.push({ type: 'session:auto_leave', payload: { playerId, gameId: round.gameId } });
    const removal = removePlayer(current, playerId, now, 'auto_leave');
    current = removal.session;
    events.push(...removal.events);
  }
  const continuing = activeSessionPlayers(current).map((p) => p.playerId);
  current = { ...current, round: { ...(current.round as DecisionRound), resolvedAt: now } };
  events.push({
    type: 'session:decision_closed',
    payload: { gameId: round.gameId, continuingPlayerIds: continuing },
  });
  return { session: current, events };
}

/**
 * Choix Poursuivre / Quitter d'un joueur présent pendant la ronde ouverte (D-034).
 * - Poursuivre : il reste, éligible à la partie suivante. Répéter le choix est sans effet.
 * - Quitter : il quitte la session immédiatement (siège vacant ; fermeture si dernier).
 * La ronde est résolue dès que tous les présents ont répondu.
 */
export function decide(
  session: Session,
  playerId: PlayerId,
  choice: 'continue' | 'leave',
  now: Date,
): SessionTransition {
  if (session.status === 'closed') {
    throw new SessionClosedError(session.id);
  }
  const round = session.round;
  if (!round || round.resolvedAt) {
    throw new NoDecisionPendingError(session.id);
  }
  if (!isActiveSessionMember(session, playerId)) {
    throw new NotASessionMemberError(session.id, playerId);
  }
  if (round.decisions[playerId]?.choice === choice) {
    return { session, events: [] };
  }
  let current: Session = {
    ...session,
    round: { ...round, decisions: { ...round.decisions, [playerId]: { choice, decidedAt: now } } },
  };
  const events: SessionEventDraft[] = [
    { type: 'session:decision', payload: { playerId, choice, gameId: round.gameId } },
  ];
  if (choice === 'leave') {
    const removal = removePlayer(current, playerId, now, 'leave');
    current = removal.session;
    events.push(...removal.events);
  }
  if (current.status === 'closed') {
    current = { ...current, round: { ...(current.round as DecisionRound), resolvedAt: now } };
  } else {
    const resolved = resolveIfComplete(current, now);
    current = resolved.session;
    events.push(...resolved.events);
  }
  return { session: bump(current, now), events };
}

/**
 * Rejoindre une session OUVERTE (D-034). Déjà présent : sans effet. Le joueur prend le
 * PREMIER siège vacant (le plus petit numéro libre), qu'il soit nouveau ou de retour :
 * jamais « à la fin ». Table pleine : refus. Pendant une ronde de décision : refus (le
 * cas n'est pas défini, voir SessionDecisionInProgressError).
 *
 * Rejoindre la session ne fait JAMAIS entrer dans la partie en cours : le joueur n'a
 * aucune carte et attend la partie suivante (il participera à la ronde de décision).
 * L'unicité « une seule session active par joueur » est garantie par la base.
 */
export function joinSession(session: Session, playerId: PlayerId, now: Date): SessionTransition {
  if (session.status === 'closed') {
    throw new SessionClosedError(session.id);
  }
  if (isActiveSessionMember(session, playerId)) {
    return { session, events: [] };
  }
  if (isRoundOpen(session)) {
    throw new SessionDecisionInProgressError(session.id);
  }
  const seat = seatMap(session).findIndex((occupant) => occupant === undefined);
  if (seat < 0) {
    throw new SessionFullError(session.id);
  }
  const players = session.players.filter((p) => p.playerId !== playerId);
  players.push({ playerId, seat, joinedAt: now, active: true });
  return {
    session: bump({ ...session, players }, now),
    events: [{ type: 'session:player_joined', payload: { playerId, seat } }],
  };
}

/**
 * Quitter la session. Déjà parti : sans effet. Refusé tant que le joueur est membre de la
 * partie ACTIVE de la session (R-19 / R-05 non tranchées). Pendant une ronde de décision,
 * quitter vaut le choix « Quitter ». Le dernier départ FERME la session (D-033).
 */
export function leaveSession(
  session: Session,
  playerId: PlayerId,
  now: Date,
  options: { inActiveGame: boolean },
): SessionTransition {
  const member = session.players.find((p) => p.playerId === playerId);
  if (!member) {
    throw new NotASessionMemberError(session.id, playerId);
  }
  if (!member.active) {
    return { session, events: [] };
  }
  if (options.inActiveGame) {
    throw new PlayerInActiveGameError(session.id, playerId);
  }
  if (isRoundOpen(session)) {
    return decide(session, playerId, 'leave', now);
  }
  const removal = removePlayer(session, playerId, now, 'leave');
  return { session: bump(removal.session, now), events: removal.events };
}

// --- Erreurs ----------------------------------------------------------------------------

export class InvalidSessionIdError extends Error {
  constructor(value: unknown) {
    super(`sessionId invalide : ${JSON.stringify(value)}`);
    this.name = 'InvalidSessionIdError';
  }
}

export function parseSessionId(value: unknown): SessionId {
  if (!isSessionId(value)) {
    throw new InvalidSessionIdError(value);
  }
  return value;
}

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`Session introuvable : ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionClosedError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`La session ${sessionId} est fermée`);
    this.name = 'SessionClosedError';
  }
}

/** Tous les sièges (maxPlayers) sont occupés. */
export class SessionFullError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`La session ${sessionId} est complète`);
    this.name = 'SessionFullError';
  }
}

/** maxPlayers est fixé à la création de la session et ne change plus (D-034). */
export class SessionMaxPlayersImmutableError extends Error {
  constructor(
    readonly sessionId: SessionId,
    readonly maxPlayers: number,
  ) {
    super(`La session ${sessionId} est fixée à ${maxPlayers} joueurs`);
    this.name = 'SessionMaxPlayersImmutableError';
  }
}

/** Un joueur n'est présent que dans une session à la fois (D-034). */
export class PlayerAlreadyInSessionError extends Error {
  constructor(readonly playerId: PlayerId) {
    super(`Le joueur ${playerId} est déjà présent dans une autre session`);
    this.name = 'PlayerAlreadyInSessionError';
  }
}

/** L'acteur n'est pas (ou plus) un joueur actif de la session. */
export class NotASessionMemberError extends Error {
  constructor(
    readonly sessionId: SessionId,
    readonly playerId: PlayerId,
  ) {
    super(`Le joueur ${playerId} n'est pas membre actif de la session ${sessionId}`);
    this.name = 'NotASessionMemberError';
  }
}

/**
 * Quitter la session est refusé tant que le joueur est membre de sa partie active :
 * quitter une partie en attente (R-19) ou en cours (fuite, R-05) relève de règles encore
 * ouvertes, le serveur refuse plutôt que de deviner.
 */
export class PlayerInActiveGameError extends Error {
  constructor(
    readonly sessionId: SessionId,
    readonly playerId: PlayerId,
  ) {
    super(`Le joueur ${playerId} participe à une partie active de la session ${sessionId}`);
    this.name = 'PlayerInActiveGameError';
  }
}

/** Parties successives : une seule partie active (waiting ou in_progress) par session. */
export class SessionGameInProgressError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`La session ${sessionId} a déjà une partie active`);
    this.name = 'SessionGameInProgressError';
  }
}

/**
 * Ronde Poursuivre/Quitter en cours : la partie suivante attend sa résolution, et une
 * arrivée pendant la ronde est refusée (le cas n'est pas défini : le joueur réessaie
 * après au plus 10 s, plutôt que le serveur ne lui attribue un choix).
 */
export class SessionDecisionInProgressError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`Décision Poursuivre/Quitter en cours dans la session ${sessionId}`);
    this.name = 'SessionDecisionInProgressError';
  }
}

/** Aucune ronde de décision ouverte : rien à choisir. */
export class NoDecisionPendingError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`Aucune décision en attente dans la session ${sessionId}`);
    this.name = 'NoDecisionPendingError';
  }
}

/**
 * J1 indéterminable : la dernière partie terminée n'a pas de gagnant (arrêtée par
 * l'administration). Aucune règle ne définit ce cas : création refusée (D-033).
 */
export class FirstPlayerUndeterminedError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`Premier joueur indéterminable dans la session ${sessionId}`);
    this.name = 'FirstPlayerUndeterminedError';
  }
}
