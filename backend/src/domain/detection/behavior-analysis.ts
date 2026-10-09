import { cardFromId, type Card } from '../cards/card';
import { RECENT_COMMANDS_LIMIT, type Game } from '../game/game';
import type { GameId, PlayerId } from '../game/game-id';
import { OFFICIAL_TER_RULES } from '../rules/official-rules';
import { AUTOMATIC_TRICK_NUMBER, TRICKS_PER_GAME } from '../rules/rule-set';
import { DETECTION_THRESHOLDS } from './detection-config';

/**
 * Analyses comportementales PURES (R-36, étape 3, D-047). Elles décrivent des faits
 * statistiques ; elles ne concluent JAMAIS à une triche, une entente ou une intention.
 * Tous les seuils viennent de `DETECTION_THRESHOLDS` (provisoires).
 */

const ratio = (part: number, total: number) => (total > 0 ? part / total : 0);
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/* ------------------------------------------------------------------------------------ */
/* FREQUENT_COPLAY                                                                       */
/* ------------------------------------------------------------------------------------ */

/** Parties surveillées terminées d'une paire, sur la fenêtre (lues en base). */
export interface CoplayStats {
  gamesTogether: number;
  sessionsTogether: number;
  /** Parties surveillées terminées de chacun sur la même fenêtre. */
  gamesOfFirst: number;
  gamesOfSecond: number;
}

export interface CoplayFinding extends CoplayStats {
  shareOfFirst: number;
  shareOfSecond: number;
}

/**
 * Fréquence inhabituelle : assez de parties communes, sur plusieurs tables, et une grande
 * part des parties de CHACUN jouées avec l'autre. Documente une fréquence, rien d'autre.
 */
export function evaluateCoplay(stats: CoplayStats): CoplayFinding | null {
  const T = DETECTION_THRESHOLDS.coplay;
  const shareOfFirst = ratio(stats.gamesTogether, stats.gamesOfFirst);
  const shareOfSecond = ratio(stats.gamesTogether, stats.gamesOfSecond);
  if (
    stats.gamesTogether < T.minGamesTogether ||
    stats.sessionsTogether < T.minSessionsTogether ||
    Math.min(shareOfFirst, shareOfSecond) < T.minShareOfGames
  ) {
    return null;
  }
  return { ...stats, shareOfFirst: round3(shareOfFirst), shareOfSecond: round3(shareOfSecond) };
}

/* ------------------------------------------------------------------------------------ */
/* CARD_CHOICE_ANOMALY                                                                   */
/* ------------------------------------------------------------------------------------ */

/**
 * Une VRAIE décision de prise de contrôle : le joueur pouvait légalement prendre le
 * contrôle ET ne pas le prendre. Jamais le meneur, jamais un choix unique.
 */
export interface ControlDecision {
  gameId: GameId;
  trickNumber: number;
  deciderId: PlayerId;
  /** Joueur qui détenait le contrôle du tour au moment du choix. */
  controllerId: PlayerId;
  tookControl: boolean;
}

export type GameExclusion =
  'NOT_FINISHED' | 'NO_PLAY' | 'NOT_PLAYED_TO_THE_END' | 'COMMAND_HISTORY_INCOMPLETE';

const AUTO_PLAY_COMMAND = /^auto-play:([0-9a-f-]+):(\d+):(\d+)$/;

/**
 * Coups joués automatiquement après TURN_TIMEOUT (D-036) : le serveur les rejoue avec un
 * `commandId` déterministe `auto-play:{gameId}:{tour}:{position}` conservé dans la partie.
 */
function autoPlayedPositions(game: Game): Set<string> {
  const positions = new Set<string>();
  for (const id of game.recentCommandIds) {
    const match = AUTO_PLAY_COMMAND.exec(id);
    if (match && match[1] === game.id) positions.add(`${match[2]}:${match[3]}`);
  }
  return positions;
}

/**
 * Reconstruit les décisions de prise de contrôle d'une partie terminée, à partir des
 * seules actions enregistrées par le serveur. Exclut :
 * - les parties non jouées jusqu'au 5e tour (victoire instantanée, égalité, arrêt admin) ;
 * - les parties dont l'historique des commandes ne permet pas d'exclure les timeouts ;
 * - le 5e tour (automatique), les coups joués après TURN_TIMEOUT ;
 * - le meneur du tour, les joueurs ayant fui (aucune carte jouée) ;
 * - toute situation sans vrai choix (toutes les cartes légales prennent, ou aucune).
 */
export function controlDecisions(
  game: Game,
): { decisions: ControlDecision[] } | { excluded: GameExclusion } {
  if (game.status !== 'finished') return { excluded: 'NOT_FINISHED' };
  const play = game.play;
  if (!play) return { excluded: 'NO_PLAY' };
  if (
    game.endReason !== 'CONTROL_AFTER_LAST_TRICK' ||
    play.completedTricks.length !== TRICKS_PER_GAME
  ) {
    return { excluded: 'NOT_PLAYED_TO_THE_END' };
  }
  // Historique tronqué : un coup automatique pourrait ne plus y figurer.
  if (game.recentCommandIds.length >= RECENT_COMMANDS_LIMIT) {
    return { excluded: 'COMMAND_HISTORY_INCOMPLETE' };
  }
  const autoPlayed = autoPlayedPositions(game);

  // Main de chaque joueur au début de chaque tour = cartes qu'il joue de ce tour au 5e.
  const playedBy = new Map<PlayerId, { trick: number; card: Card }[]>();
  for (const trick of play.completedTricks) {
    for (const p of trick.plays) {
      const list = playedBy.get(p.playerId) ?? [];
      list.push({ trick: trick.number, card: cardFromId(p.cardId) });
      playedBy.set(p.playerId, list);
    }
  }
  const handAt = (playerId: PlayerId, trickNumber: number): Card[] | null => {
    const cards = playedBy.get(playerId);
    if (!cards || cards.length !== TRICKS_PER_GAME) return null; // main non reconstructible
    return cards.filter((c) => c.trick >= trickNumber).map((c) => c.card);
  };

  const rules = OFFICIAL_TER_RULES;
  const decisions: ControlDecision[] = [];
  for (const trick of play.completedTricks) {
    if (trick.number >= AUTOMATIC_TRICK_NUMBER) continue;
    const lead = trick.plays[0];
    if (!lead) continue;
    const leadCard = cardFromId(lead.cardId);
    let control = { playerId: lead.playerId, card: leadCard };
    trick.plays.forEach((p, position) => {
      const card = cardFromId(p.cardId);
      if (position > 0 && !autoPlayed.has(`${trick.number}:${position}`)) {
        const hand = handAt(p.playerId, trick.number);
        if (hand) {
          const legal = hand.filter((c) =>
            rules.cardPlayability({
              card: c,
              hand,
              leadCard,
              controlCard: control.card,
              sameColor: rules.sameColor,
            }),
          );
          const takes = (c: Card) => rules.sameColor(c, leadCard) && c.value > control.card.value;
          const takers = legal.filter(takes).length;
          if (takers > 0 && takers < legal.length) {
            decisions.push({
              gameId: game.id,
              trickNumber: trick.number,
              deciderId: p.playerId,
              controllerId: control.playerId,
              tookControl: takes(card),
            });
          }
        }
      }
      // Même règle que le moteur : la plus haute carte de la famille du meneur contrôle.
      if (position > 0 && rules.sameColor(card, leadCard) && card.value > control.card.value) {
        control = { playerId: p.playerId, card };
      }
    });
  }
  return { decisions };
}

export interface CardChoiceFinding {
  deciderId: PlayerId;
  controllerId: PlayerId;
  opportunitiesWithController: number;
  declinedWithController: number;
  declineRateWithController: number;
  opportunitiesWithOthers: number;
  declinedWithOthers: number;
  declineRateWithOthers: number;
  gamesWithDecisions: number;
}

/**
 * Anomalie de choix : face à CE contrôleur, le joueur renonce à prendre le contrôle bien
 * plus souvent que face aux autres (son propre historique sert de référence). Sans assez
 * d'occasions des deux côtés, aucun signal.
 */
export function evaluateCardChoice(
  decisions: readonly ControlDecision[],
  deciderId: PlayerId,
  controllerId: PlayerId,
): CardChoiceFinding | null {
  const T = DETECTION_THRESHOLDS.cardBehavior;
  const own = decisions.filter((d) => d.deciderId === deciderId);
  const withController = own.filter((d) => d.controllerId === controllerId);
  const withOthers = own.filter((d) => d.controllerId !== controllerId);
  if (
    withController.length < T.minOpportunities ||
    withOthers.length < T.minBaselineOpportunities
  ) {
    return null;
  }
  const declinedWithController = withController.filter((d) => !d.tookControl).length;
  const declinedWithOthers = withOthers.filter((d) => !d.tookControl).length;
  const rateWith = ratio(declinedWithController, withController.length);
  const rateOthers = ratio(declinedWithOthers, withOthers.length);
  if (rateWith < T.anomalyRate || rateWith - rateOthers < T.minRateGap) return null;
  return {
    deciderId,
    controllerId,
    opportunitiesWithController: withController.length,
    declinedWithController,
    declineRateWithController: round3(rateWith),
    opportunitiesWithOthers: withOthers.length,
    declinedWithOthers,
    declineRateWithOthers: round3(rateOthers),
    gamesWithDecisions: new Set(own.map((d) => d.gameId)).size,
  };
}

/* ------------------------------------------------------------------------------------ */
/* CORRELATED_WINS                                                                       */
/* ------------------------------------------------------------------------------------ */

/** Résultat d'une partie surveillée terminée avec un gagnant. */
export interface GameOutcome {
  gameId: GameId;
  playerIds: PlayerId[];
  winnerId: PlayerId;
}

export interface CorrelatedWinsFinding {
  gamesTogether: number;
  pairWins: number;
  winsOfFirst: number;
  winsOfSecond: number;
  observedRate: number;
  expectedRate: number;
  zScore: number;
  /** Référence de chaque joueur : son taux personnel sans l'autre, ou le hasard (1/n). */
  baselineOfFirst: { games: number; winRate: number | null };
  baselineOfSecond: { games: number; winRate: number | null };
}

/**
 * Corrélation des résultats d'une paire : dans leurs parties communes à 3 ou 4 joueurs,
 * la paire gagne-t-elle bien plus souvent qu'attendu ? L'attendu tient compte du niveau de
 * chacun (taux de victoire personnel SANS l'autre, sinon le hasard 1/n) : un joueur fort
 * ne crée pas de signal à lui seul. Observation statistique, jamais causale.
 */
export function evaluateCorrelatedWins(
  outcomes: readonly GameOutcome[],
  pair: readonly [PlayerId, PlayerId],
): CorrelatedWinsFinding | null {
  const T = DETECTION_THRESHOLDS.correlatedWins;
  const [a, b] = pair;
  const informative = outcomes.filter((o) => o.playerIds.length >= 3);
  const together = informative.filter((o) => o.playerIds.includes(a) && o.playerIds.includes(b));
  if (together.length < T.minGamesTogether) return null;

  const baseline = (self: PlayerId, other: PlayerId) => {
    const games = informative.filter(
      (o) => o.playerIds.includes(self) && !o.playerIds.includes(other),
    );
    const winRate =
      games.length >= T.minBaselineGames
        ? ratio(games.filter((o) => o.winnerId === self).length, games.length)
        : null;
    return { games: games.length, winRate };
  };
  const baseA = baseline(a, b);
  const baseB = baseline(b, a);

  let expected = 0;
  let variance = 0;
  let winsA = 0;
  let winsB = 0;
  for (const o of together) {
    const chance = 1 / o.playerIds.length;
    const p = Math.min(1, (baseA.winRate ?? chance) + (baseB.winRate ?? chance));
    expected += p;
    variance += p * (1 - p);
    if (o.winnerId === a) winsA += 1;
    if (o.winnerId === b) winsB += 1;
  }
  const pairWins = winsA + winsB;
  if (variance <= 0) return null; // attendu certain : rien d'inhabituel à mesurer
  const zScore = (pairWins - expected) / Math.sqrt(variance);
  const observedRate = ratio(pairWins, together.length);
  const expectedRate = ratio(expected, together.length);
  if (observedRate - expectedRate < T.minWinRateGap || zScore < T.minZScore) return null;
  return {
    gamesTogether: together.length,
    pairWins,
    winsOfFirst: winsA,
    winsOfSecond: winsB,
    observedRate: round3(observedRate),
    expectedRate: round3(expectedRate),
    zScore: Math.round(zScore * 100) / 100,
    baselineOfFirst: { games: baseA.games, winRate: baseA.winRate && round3(baseA.winRate) },
    baselineOfSecond: { games: baseB.games, winRate: baseB.winRate && round3(baseB.winRate) },
  };
}

/* ------------------------------------------------------------------------------------ */
/* CONNECTION_PATTERN                                                                    */
/* ------------------------------------------------------------------------------------ */

/** Une table surveillée commune : arrivées et dernières connexions de chacun. */
export interface SharedTable {
  joinedFirst: Date;
  joinedSecond: Date;
  /** Dernière connexion (début de session d'authentification) avant l'arrivée, si connue. */
  loginFirst: Date | null;
  loginSecond: Date | null;
}

export interface ConnectionFinding {
  tablesTogether: number;
  synchronizedTables: number;
  synchronizedArrivals: number;
  synchronizedLogins: number;
  medianArrivalGapSeconds: number;
}

/**
 * Habitudes de connexion corrélées : arrivées à la même table surveillée, ou connexions
 * juste avant, à quelques secondes d'écart, de façon répétée. Aucune donnée réseau (IP) :
 * l'application n'en conserve aucune.
 */
export function evaluateConnectionPattern(
  tables: readonly SharedTable[],
): ConnectionFinding | null {
  const T = DETECTION_THRESHOLDS.connection;
  const gap = (x: Date, y: Date) => Math.abs(x.getTime() - y.getTime());
  let synchronizedTables = 0;
  let synchronizedArrivals = 0;
  let synchronizedLogins = 0;
  const arrivalGaps: number[] = [];
  for (const t of tables) {
    const arrivalGap = gap(t.joinedFirst, t.joinedSecond);
    arrivalGaps.push(arrivalGap);
    const loginUsable = (login: Date | null, joined: Date) =>
      login !== null && joined.getTime() - login.getTime() <= T.loginLookbackMs;
    const arrivals = arrivalGap <= T.syncWindowMs;
    const logins =
      loginUsable(t.loginFirst, t.joinedFirst) &&
      loginUsable(t.loginSecond, t.joinedSecond) &&
      gap(t.loginFirst as Date, t.loginSecond as Date) <= T.syncWindowMs;
    if (arrivals) synchronizedArrivals += 1;
    if (logins) synchronizedLogins += 1;
    if (arrivals || logins) synchronizedTables += 1;
  }
  if (
    synchronizedTables < T.minRepetitions ||
    ratio(synchronizedTables, tables.length) < T.minSyncShare
  ) {
    return null;
  }
  const sorted = [...arrivalGaps].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    tablesTogether: tables.length,
    synchronizedTables,
    synchronizedArrivals,
    synchronizedLogins,
    medianArrivalGapSeconds: Math.round(median / 1000),
  };
}
